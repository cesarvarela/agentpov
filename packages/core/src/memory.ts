import {
  ancestorsOf,
  listDir,
  managedDirFor,
  projectClaudeDir,
  readText,
  sizeOf,
  userClaudeDir,
  type ResolveRun,
} from "./context.js";
import { frontmatterList, parseFrontmatterFields, summarize } from "./frontmatter.js";
import { globCoversDirectory, globToRegExp, matchGlob } from "./glob.js";
import { descendingChain, toAbsolute, toPosix } from "./paths.js";
import {
  type ConfigLayer,
  type MemoryEntry,
  type MemoryLoading,
  type SettingsEntry,
} from "./types.js";

/** Claude Code follows `@imports` four hops deep. */
const MAX_IMPORT_DEPTH = 4;

export const REASON_ALWAYS = "always loaded";
export const REASON_WHEN_READ = "loaded when this file is read";
export const REASON_WHEN_READ_IN_FOLDER = "loaded when files in this folder are read";
export const REASON_RECALLED = "recalled on demand";
/** Prefix of a `paths:`-scoped rule's reason; the globs follow. */
export const REASON_WHEN_READ_MATCHING = "loaded when Claude reads a file matching";

/** `loaded when Claude reads a file matching src/**\/*.ts, docs/**` */
export function reasonForRuleGlobs(globs: string[]): string {
  return `${REASON_WHEN_READ_MATCHING} ${globs.join(", ")}`;
}

interface Candidate {
  path: string;
  layer: ConfigLayer;
  scopedToFile: boolean;
  /** For a `paths:`-scoped rule: the globs it declares, as written. */
  globs?: string[];
}

/** One `@path` reference found in a CLAUDE.md. */
export interface ImportReference {
  raw: string;
  line: number;
}

const FENCE = /^\s*(?:```|~~~)/;

/**
 * Finds `@path` imports: a token that starts a line or follows whitespace,
 * begins with `@`, and looks like a path rather than an email address.
 */
export function findImports(content: string): ImportReference[] {
  const results: ImportReference[] = [];
  let inFence = false;
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const pattern = /(?:^|\s)@(\S+)/g;
    const prose = blankCodeSpans(line);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(prose)) !== null) {
      const token = trimTrailingPunctuation(match[1]!);
      if (!looksLikePath(token)) continue;
      results.push({ raw: token, line: index + 1 });
    }
  }
  return results;
}

/**
 * `line` with inline code spans (`` `…` ``, any backtick run length) replaced
 * by spaces, since Claude Code does not follow `@path` inside code. An
 * unclosed backtick run is literal text, as in CommonMark.
 */
function blankCodeSpans(line: string): string {
  return line.replace(/(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (span) => " ".repeat(span.length));
}

function trimTrailingPunctuation(token: string): string {
  return token.replace(/[,;:)\]}]+$/, "");
}

function looksLikePath(token: string): boolean {
  if (token.length === 0) return false;
  // Claude Code resolves slash-free, extension-free imports too (`@README`),
  // so anything after a standalone `@` counts. An email never reaches here:
  // `findImports` only matches an `@` that starts a line or follows whitespace.
  if (token.includes("@")) return false;
  return true;
}

function resolveImport(run: ResolveRun, fromDir: string, raw: string): string {
  if (raw.startsWith("~/")) return toAbsolute(run.p, run.homeDir, raw.slice(2));
  return toAbsolute(run.p, fromDir, raw);
}

async function readMemoryFile(
  run: ResolveRun,
  candidate: Candidate,
  kind: MemoryEntry["kind"],
  reason: string,
  loading: MemoryLoading,
  extra?: { importedBy: string; importedAtLine: number },
): Promise<MemoryEntry | null> {
  const content = await readText(run, candidate.path);
  if (content === null) return null;
  const entry: MemoryEntry = {
    path: candidate.path,
    layer: candidate.layer,
    kind,
    content,
    bytes: await sizeOf(run, candidate.path, content),
    reason,
    loading,
    scopedToFile: candidate.scopedToFile,
  };
  const summary = summarize(content);
  if (summary) entry.summary = summary;
  if (candidate.globs) entry.appliesToGlobs = candidate.globs;
  if (extra) {
    entry.importedBy = extra.importedBy;
    entry.importedAtLine = extra.importedAtLine;
  }
  return entry;
}

/**
 * How a rule file's imports reach context. Checked against Claude Code 2.1.277:
 * `/context` at launch lists the import target of a `paths:`-scoped rule as a
 * project memory file even though the rule itself is not listed, so the CLI
 * resolves the imports of every rule eagerly and loads them always.
 */
interface ImportOverride {
  loading: MemoryLoading;
  reason: (parentName: string, line: number) => string;
}

async function collectImports(
  run: ResolveRun,
  parent: MemoryEntry,
  seen: Set<string>,
  depth: number,
  override?: ImportOverride,
): Promise<MemoryEntry[]> {
  if (depth > MAX_IMPORT_DEPTH) return [];
  const content = parent.content ?? "";
  const parentDir = run.p.dirname(parent.path);
  const parentName = run.p.basename(parent.path);
  const out: MemoryEntry[] = [];

  for (const reference of findImports(content)) {
    const target = resolveImport(run, parentDir, reference.raw);
    if (seen.has(target)) continue;
    seen.add(target);
    const entry = await readMemoryFile(
      run,
      {
        path: target,
        layer: parent.layer,
        scopedToFile: override ? false : parent.scopedToFile,
      },
      "import",
      override
        ? override.reason(parentName, reference.line)
        : `inlined at line ${reference.line} of ${parentName}`,
      // An import is inlined into its parent, so it reaches context exactly
      // when the parent does — unless the parent is a rule, whose imports the
      // CLI loads at launch either way.
      override ? override.loading : parent.loading,
      { importedBy: parent.path, importedAtLine: reference.line },
    );
    if (!entry) {
      run.diagnostics.push(
        `${target}: imported at line ${reference.line} of ${parent.path} but not found`,
      );
      continue;
    }
    out.push(entry);
    out.push(...(await collectImports(run, entry, seen, depth + 1, override)));
  }
  return out;
}

/**
 * `/Users/x/my.proj` → `-Users-x-my-proj`: every character that is not a
 * letter or digit becomes `-`, as Claude Code 2.1.280 names
 * `~/.claude/projects/<slug>`.
 */
export function projectSlug(folder: string, _platform?: NodeJS.Platform): string {
  return folder.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Auto-memory lives under the main checkout's root, so a subfolder of a
 * repository and every worktree of it share one memory directory.
 */
async function collectMemoryDirectory(run: ResolveRun): Promise<MemoryEntry[]> {
  const slug = projectSlug(run.repoRoot);
  const dir = run.p.join(userClaudeDir(run), "projects", slug, "memory");
  const entries = await listDir(run, dir);
  const markdown = entries
    .filter((entry) => !entry.isDirectory && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  const out: MemoryEntry[] = [];
  const index = markdown.find((name) => name === "MEMORY.md");
  if (index) {
    const entry = await readMemoryFile(
      run,
      { path: run.p.join(dir, index), layer: "user", scopedToFile: false },
      "memory-index",
      REASON_ALWAYS,
      "always",
    );
    if (entry) out.push(entry);
  }
  for (const name of markdown) {
    if (name === "MEMORY.md") continue;
    const entry = await readMemoryFile(
      run,
      { path: run.p.join(dir, name), layer: "user", scopedToFile: false },
      "memory-file",
      REASON_RECALLED,
      "on-demand",
    );
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Expands `{a,b}` alternatives, innermost group first: `src/{a,b}/*.ts` →
 * `src/a/*.ts`, `src/b/*.ts`. A pattern without braces comes back unchanged.
 */
export function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open < 0) return [pattern];

  let depth = 0;
  let close = -1;
  for (let i = open; i < pattern.length; i += 1) {
    const char = pattern[i]!;
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return [pattern]; // unbalanced; treat literally

  const before = pattern.slice(0, open);
  const after = pattern.slice(close + 1);
  const alternatives: string[] = [];
  let current = "";
  let nested = 0;
  for (const char of pattern.slice(open + 1, close)) {
    if (char === "{") nested += 1;
    else if (char === "}") nested -= 1;
    if (char === "," && nested === 0) {
      alternatives.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  alternatives.push(current);

  const out: string[] = [];
  for (const alternative of alternatives) {
    out.push(...expandBraces(`${before}${alternative}${after}`));
  }
  return out;
}

/** Every `.md` file under `root`, recursively, in stable path order. */
async function listRuleFiles(run: ResolveRun, root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = [...(await listDir(run, dir))].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const path = run.p.join(dir, entry.name);
      if (entry.isDirectory) await walk(path);
      else if (entry.name.toLowerCase().endsWith(".md")) out.push(path);
    }
  };
  await walk(root);
  return out.sort();
}

/** Does a rule's `paths:` glob, relative to `base`, reach the resolved target? */
function ruleGlobHitsTarget(run: ResolveRun, glob: string, base: string): boolean {
  const relativeTarget = toPosix(run.p.relative(base, run.file));
  for (const expanded of expandBraces(glob)) {
    const pattern = toPosix(expanded.replace(/^\.\//, "").replace(/^\/+/, ""));
    if (pattern.length === 0) continue;
    if (run.targetKind === "directory") {
      if (globCoversDirectory(pattern, relativeTarget)) return true;
    } else if (matchGlob(pattern, relativeTarget)) return true;
  }
  return false;
}

/** `imported by payments.md at launch, even though the rule itself is conditional` */
export function reasonForConditionalRuleImport(ruleName: string): string {
  return `imported by ${ruleName} at launch, even though the rule itself is conditional`;
}

/**
 * `.claude/rules/**\/*.md`. A rule without `paths:` loads at launch, like
 * `.claude/CLAUDE.md`; one with `paths:` loads only when Claude reads a
 * matching file, so it is listed only when the target is covered.
 *
 * A rule's `@imports` are a separate matter: the CLI resolves them eagerly and
 * loads them at launch whether or not the rule's `paths:` cover the target, so
 * they are always emitted, and after the rules themselves (matching the order
 * `/context` printed in the `memory-rules` fixture).
 */
async function collectRules(
  run: ResolveRun,
  root: string,
  layer: ConfigLayer,
  seen: Set<string>,
  excluded: (path: string) => boolean,
  base: string = run.folder,
): Promise<MemoryEntry[]> {
  const out: MemoryEntry[] = [];
  const imports: MemoryEntry[] = [];

  for (const path of await listRuleFiles(run, root)) {
    if (seen.has(path) || excluded(path)) continue;
    const content = await readText(run, path);
    if (content === null) continue;
    const globs = frontmatterList(parseFrontmatterFields(content), "paths");
    const conditional = globs.length > 0;
    const matches =
      !conditional || globs.some((glob) => ruleGlobHitsTarget(run, glob, base));

    const candidate: Candidate = conditional
      ? { path, layer, scopedToFile: true, globs }
      : { path, layer, scopedToFile: false };
    const reason = conditional ? reasonForRuleGlobs(globs) : REASON_ALWAYS;
    const loading: MemoryLoading = conditional ? "on-read" : "always";

    const entry = await readMemoryFile(run, candidate, "rule", reason, loading);
    if (!entry) continue;
    if (matches) {
      seen.add(path);
      out.push(entry);
    }
    // A conditional rule's imports still load at launch, so they are emitted
    // even when the rule itself is left out.
    const ruleName = run.p.basename(path);
    imports.push(
      ...(await collectImports(run, entry, seen, 1, {
        loading: "always",
        reason: conditional
          ? () => reasonForConditionalRuleImport(ruleName)
          : (parentName, line) => `inlined at line ${line} of ${parentName}`,
      })),
    );
  }

  return [...out, ...imports];
}

/**
 * `claudeMdExcludes` from every settings layer: globs or absolute paths
 * matched against a CLAUDE.md or rule file's absolute path. Managed files
 * can't be excluded.
 */
function excludesFrom(settings: SettingsEntry[]): (path: string, layer: ConfigLayer) => boolean {
  const patterns: RegExp[] = [];
  for (const entry of settings) {
    const value = entry.values["claudeMdExcludes"];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string" && item.length > 0) patterns.push(globToRegExp(toPosix(item)));
    }
  }
  return (path, layer) =>
    layer !== "managed" && patterns.some((pattern) => pattern.test(toPosix(path)));
}

/**
 * Every CLAUDE.md, rule, import and memory file that applies, lowest precedence first.
 *
 * Besides the project folder itself, Claude Code 2.1.280 loads `CLAUDE.md`,
 * `.claude/CLAUDE.md`, `.claude/rules` and `CLAUDE.local.md` from every
 * directory above it, up to but not including the filesystem root — past the
 * git root too.
 */
export async function collectMemory(
  run: ResolveRun,
  settings: SettingsEntry[] = [],
): Promise<MemoryEntry[]> {
  const { p } = run;
  const isExcluded = excludesFrom(settings);
  // A directory target owns its own CLAUDE.md, so the chain starts at the
  // target itself; for a file it starts at the directory holding the file.
  const targetDir =
    run.targetKind === "directory" ? run.file : p.dirname(run.file);

  const candidates: Candidate[] = [
    { path: p.join(managedDirFor(run.platform), "CLAUDE.md"), layer: "managed", scopedToFile: false },
    { path: p.join(userClaudeDir(run), "CLAUDE.md"), layer: "user", scopedToFile: false },
  ];

  const projectCandidates: Candidate[] = [
    { path: p.join(run.folder, "CLAUDE.md"), layer: "project", scopedToFile: false },
    { path: p.join(projectClaudeDir(run), "CLAUDE.md"), layer: "project", scopedToFile: false },
    { path: p.join(run.folder, "CLAUDE.local.md"), layer: "local", scopedToFile: false },
  ];

  const directoryCandidates: Candidate[] = descendingChain(p, run.folder, targetDir).map(
    (dir) => ({ path: p.join(dir, "CLAUDE.md"), layer: "directory", scopedToFile: true }),
  );

  const scopedReason =
    run.targetKind === "directory" ? REASON_WHEN_READ_IN_FOLDER : REASON_WHEN_READ;

  const out: MemoryEntry[] = [];
  const seen = new Set<string>();

  const emit = async (list: Candidate[]): Promise<void> => {
    for (const candidate of list) {
      if (seen.has(candidate.path) || isExcluded(candidate.path, candidate.layer)) continue;
      seen.add(candidate.path);
      const reason = candidate.scopedToFile ? scopedReason : REASON_ALWAYS;
      const loading: MemoryLoading = candidate.scopedToFile ? "on-read" : "always";
      const entry = await readMemoryFile(
        run,
        candidate,
        "claude-md",
        reason,
        loading,
      );
      if (!entry) continue;
      out.push(entry);
      out.push(...(await collectImports(run, entry, seen, 1)));
    }
  };

  const rules = (root: string, layer: ConfigLayer, base?: string) =>
    collectRules(run, root, layer, seen, (path) => isExcluded(path, layer), base);

  await emit(candidates);
  out.push(...(await rules(p.join(userClaudeDir(run), "rules"), "user")));
  out.push(...(await collectMemoryDirectory(run)));

  // Parent folders, farthest first, in the order Claude Code lists them. A
  // worktree kept inside its main checkout skips that checkout's checked-in
  // files, which duplicate its own, but still gets its CLAUDE.local.md.
  const parents = ancestorsOf(p, run.folder).slice(1, -1).reverse();
  const inMainCheckout = (dir: string) =>
    run.gitRoot !== null &&
    run.gitRoot !== run.repoRoot &&
    (dir === run.repoRoot || dir.startsWith(`${run.repoRoot}${p.sep}`));
  for (const dir of parents) {
    if (!inMainCheckout(dir)) {
      await emit([
        { path: p.join(dir, "CLAUDE.md"), layer: "project", scopedToFile: false },
        { path: p.join(dir, ".claude", "CLAUDE.md"), layer: "project", scopedToFile: false },
      ]);
      out.push(...(await rules(p.join(dir, ".claude", "rules"), "project", dir)));
    }
    await emit([{ path: p.join(dir, "CLAUDE.local.md"), layer: "local", scopedToFile: false }]);
  }

  await emit(projectCandidates);
  out.push(...(await rules(p.join(projectClaudeDir(run), "rules"), "project")));
  await emit(directoryCandidates);

  return out;
}
