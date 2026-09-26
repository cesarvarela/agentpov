import {
  listDir,
  projectDirsUpToGitRoot,
  readText,
  userClaudeDir,
  type ResolveRun,
} from "./context.js";
import { markShadowed } from "./discovery.js";
import { enabledPlugins, pluginComponentPaths, type LoadedPlugin } from "./plugins.js";
import {
  type ConfigLayer,
  type EffectiveSettings,
  type WorkflowEntry,
} from "./types.js";

/* -------------------------------------------------------------------------- */
/* meta block                                                                  */
/* -------------------------------------------------------------------------- */

export interface WorkflowMeta {
  name?: string;
  description?: string;
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };

/**
 * Reads the string literal starting at `text[start]` (a quote or backtick).
 * `value` is `null` for a template literal with `${...}`, which isn't a
 * literal value.
 */
function readString(text: string, start: number): { value: string | null; end: number } {
  const quote = text[start]!;
  let value: string | null = "";
  let i = start + 1;
  while (i < text.length) {
    const char = text[i]!;
    if (char === "\\") {
      const next = text[i + 1] ?? "";
      if (value !== null) value += ESCAPES[next] ?? (next === "\n" ? "" : next);
      i += 2;
      continue;
    }
    if (char === quote) return { value, end: i + 1 };
    if (quote === "`" && char === "$" && text[i + 1] === "{") value = null;
    if (value !== null) value += char;
    i += 1;
  }
  return { value: null, end: text.length };
}

function skipSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  return i;
}

/** Skips leading whitespace, comments and a hashbang line. */
function skipTrivia(text: string): number {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (text.startsWith("#!", i)) i = text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i);
  while (i < text.length) {
    i = skipSpace(text, i);
    if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

/**
 * The string-valued `name` and `description` of a saved workflow's
 * `export const meta = { ... }`, read without running the script.
 *
 * Docs (/workflows, "Edit a saved script"): `export const meta` must be the
 * first statement and a plain object literal with a `name` and a
 * `description`. This scans only that literal's top-level keys; a value that
 * isn't a string literal is skipped. Returns `undefined` when the file doesn't
 * start with a `meta` export.
 */
export function parseWorkflowMeta(source: string): WorkflowMeta | undefined {
  const start = skipTrivia(source);
  const head = /^export\s+const\s+meta\s*=\s*\{/.exec(source.slice(start));
  if (!head) return undefined;

  const meta: WorkflowMeta = {};
  const text = source;
  let depth = 0;
  let i = start + head[0].length - 1;

  // After `key:` at the top level, read a string value if there is one.
  const takeValue = (key: string, from: number): number => {
    const at = skipSpace(text, from);
    const quote = text[at];
    if (quote !== '"' && quote !== "'" && quote !== "`") return at;
    const read = readString(text, at);
    if (read.value !== null && (key === "name" || key === "description") && meta[key] === undefined) {
      meta[key] = read.value;
    }
    return read.end;
  };

  while (i < text.length) {
    const char = text[i]!;
    if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const read = readString(text, i);
      const after = skipSpace(text, read.end);
      if (depth === 1 && read.value !== null && text[after] === ":") {
        i = takeValue(read.value, after + 1);
      } else {
        i = read.end;
      }
      continue;
    }
    if (char === "{" || char === "[" || char === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (char === "}" || char === "]" || char === ")") {
      depth -= 1;
      i += 1;
      if (depth === 0) break;
      continue;
    }
    if (depth === 1 && /[A-Za-z_$]/.test(char)) {
      const ident = /^[A-Za-z_$][\w$]*/.exec(text.slice(i, i + 256))![0];
      const after = skipSpace(text, i + ident.length);
      i = text[after] === ":" ? takeValue(ident, after + 1) : i + ident.length;
      continue;
    }
    i += 1;
  }
  return meta;
}

/* -------------------------------------------------------------------------- */
/* discovery                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Docs (/workflows, "Save the workflow for reuse"): among nested project
 * `.claude/workflows/` directories the one closest to the working directory
 * wins, and "if a project workflow and a personal workflow share a name, the
 * project one runs". Plugin workflows are namespaced, so they don't collide.
 */
const WORKFLOW_RANK = {
  project: 500,
  user: 100,
  plugin: 0,
} as const;

interface WorkflowScan {
  layer: ConfigLayer;
  rank: number;
  plugin?: string;
}

/**
 * The name is `meta.name`; the docs don't say what a script without one is
 * called, so it falls back to the file name without `.js`.
 */
function workflowEntry(
  run: ResolveRun,
  scan: WorkflowScan,
  path: string,
  content: string,
): WorkflowEntry {
  const meta = parseWorkflowMeta(content);
  const label = meta?.name ?? run.p.basename(path).replace(/\.js$/i, "");
  const prefix = scan.plugin ? `${scan.plugin}:` : "";
  const entry: WorkflowEntry = {
    path,
    layer: scan.layer,
    name: prefix && !label.startsWith(prefix) ? `${prefix}${label}` : label,
  };
  if (meta?.description) entry.description = meta.description;
  if (scan.plugin) entry.plugin = scan.plugin;
  return entry;
}

/** `*.js` directly inside `dir`. */
async function workflowsIn(
  run: ResolveRun,
  dir: string,
  scan: WorkflowScan,
  ranks: Map<WorkflowEntry, number>,
): Promise<WorkflowEntry[]> {
  const names = (await listDir(run, dir))
    .filter((entry) => !entry.isDirectory && entry.name.toLowerCase().endsWith(".js"))
    .map((entry) => entry.name)
    .sort();
  const out: WorkflowEntry[] = [];
  for (const name of names) {
    const path = run.p.join(dir, name);
    const content = await readText(run, path);
    if (content === null) continue;
    const workflow = workflowEntry(run, scan, path, content);
    ranks.set(workflow, scan.rank);
    out.push(workflow);
  }
  return out;
}

/**
 * Workflows from enabled plugins, named `<plugin>:<meta.name>` (docs:
 * /workflows, "Distribute a workflow in a plugin"). The manifest `workflows`
 * key **replaces** the default `workflows/` scan and takes `.js` files or
 * directories (/plugins/manifest-reference).
 */
async function pluginWorkflows(
  run: ResolveRun,
  plugins: LoadedPlugin[],
  ranks: Map<WorkflowEntry, number>,
): Promise<WorkflowEntry[]> {
  const out: WorkflowEntry[] = [];
  for (const plugin of enabledPlugins(plugins)) {
    const scan: WorkflowScan = {
      layer: plugin.entry.layer,
      rank: WORKFLOW_RANK.plugin,
      plugin: plugin.entry.name,
    };
    const seen = new Set<string>();
    for (const path of pluginComponentPaths(run, plugin, "workflows", "workflows", "replaces")) {
      const found: WorkflowEntry[] = [];
      if ((await run.fs.readDir(path)) !== null) {
        found.push(...(await workflowsIn(run, path, scan, ranks)));
      } else if (path.toLowerCase().endsWith(".js")) {
        const content = await readText(run, path);
        if (content === null) continue;
        const workflow = workflowEntry(run, scan, path, content);
        ranks.set(workflow, scan.rank);
        found.push(workflow);
      }
      for (const workflow of found) {
        if (seen.has(workflow.path)) continue;
        seen.add(workflow.path);
        out.push(workflow);
      }
    }
  }
  return out;
}

/** Why workflows are off, from the effective switch that turned them off. */
function offReason(effective: EffectiveSettings): string {
  const { key, source, note } = effective.workflows;
  if (source) return `workflows are turned off by ${key} in ${source.path}`;
  return note ? `workflows are turned off: ${note}` : `workflows are turned off (${key})`;
}

/**
 * Saved workflows: `~/.claude/workflows/*.js` (under `CLAUDE_CONFIG_DIR` when
 * set), `.claude/workflows/*.js` in every directory from the folder up to the
 * repository root, and enabled plugins' `workflows/`. Docs: /workflows,
 * Claude Code 2.1.280.
 *
 * When `effective.workflows` says workflows are off, every entry is kept but
 * marked `disabled` with the reason.
 */
export async function collectWorkflows(
  run: ResolveRun,
  plugins: LoadedPlugin[],
  effective: EffectiveSettings,
): Promise<WorkflowEntry[]> {
  const ranks = new Map<WorkflowEntry, number>();
  const out: WorkflowEntry[] = [
    ...(await workflowsIn(
      run,
      run.p.join(userClaudeDir(run), "workflows"),
      { layer: "user", rank: WORKFLOW_RANK.user },
      ranks,
    )),
  ];
  for (const [index, dir] of projectDirsUpToGitRoot(run).entries()) {
    out.push(
      ...(await workflowsIn(
        run,
        run.p.join(dir, ".claude", "workflows"),
        { layer: "project", rank: WORKFLOW_RANK.project - index },
        ranks,
      )),
    );
  }
  out.push(...(await pluginWorkflows(run, plugins, ranks)));

  markShadowed(
    out,
    (entry) => entry.name,
    (entry) => ranks.get(entry) ?? 0,
    (entry, shadowedBy) => {
      entry.shadowedBy = shadowedBy;
    },
  );

  if (!effective.workflows.value) {
    const reason = offReason(effective);
    for (const workflow of out) workflow.disabled = reason;
  }

  return out;
}
