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
import { asBoolean, asString, effectiveSetting } from "./settings.js";
import {
  type ConfigLayer,
  type EffectiveSettings,
  type InstructionFilesMode,
  type MemoryEntry,
  type MemoryKind,
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
/** An `AGENTS.md` read at launch under `claude-md-or-agents-md`, the default. */
export const REASON_AGENTS_INSTEAD =
  "loaded instead of CLAUDE.md: no CLAUDE.md in this folder or above it";
/** An `AGENTS.md` read at launch under `claude-md-and-agents-md`. */
export const REASON_AGENTS_ALONGSIDE =
  "loaded after this folder's CLAUDE.md files (instructionFiles: claude-md-and-agents-md)";
/** The managed `claudeMd` setting. */
export const REASON_MANAGED_INLINE =
  "set by claudeMd in managed settings, loaded ahead of user and project CLAUDE.md";

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

/** One `@path` reference found in a CLAUDE.md, AGENTS.md or rule. */
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
 * Where auto memory lives, or `null` when none loads.
 *
 * By default it lives under the main checkout's root, so a subfolder of a
 * repository and every worktree of it share one memory directory.
 *
 * Docs (/settings-reference#automemorydirectory, /memory#storage-location),
 * checked against Claude Code 2.1.280: `autoMemoryDirectory` replaces that
 * directory outright (it holds `MEMORY.md` itself, no `<project>` slug under
 * it). Any settings layer may set it; the value must be absolute or start with
 * `~/`, which expands to the home directory. From project or local settings it
 * is honored under the workspace trust rule, which a static resolver can't
 * see, so the folder is assumed trusted. While
 * `permissions.blockReadsOutsideWorkingDirectories` is on, a directory chosen
 * by the project's `.claude/settings.json` loads nothing. (The same applies to
 * a `settings.local.json` "treated as repository-supplied", which depends on
 * trust state this resolver can't see, so that case is not modelled.)
 */
function autoMemoryDirectory(run: ResolveRun, settings: SettingsEntry[]): string | null {
  const home = (value: string) => /^~[\\/]/.test(value);
  const setting = effectiveSetting<string | undefined>(settings, "autoMemoryDirectory", {
    parse: asString,
    default: undefined,
    reject: (value) =>
      value !== undefined && !home(value) && !run.p.isAbsolute(value)
        ? "must be an absolute path or start with ~/"
        : undefined,
  });
  if (setting.note) run.diagnostics.push(`autoMemoryDirectory ${setting.note}`);
  const value = setting.value;
  if (value === undefined || !setting.source) {
    return run.p.join(userClaudeDir(run), "projects", projectSlug(run.repoRoot), "memory");
  }
  if (setting.source.layer === "project") {
    const block = effectiveSetting(settings, "permissions.blockReadsOutsideWorkingDirectories", {
      parse: asBoolean,
      default: false,
    });
    if (block.value) {
      run.diagnostics.push(
        `autoMemoryDirectory from ${setting.source.path} loads no auto memory while permissions.blockReadsOutsideWorkingDirectories is on`,
      );
      return null;
    }
  }
  return home(value)
    ? toAbsolute(run.p, run.homeDir, value.slice(2))
    : toAbsolute(run.p, run.folder, value);
}

async function collectMemoryDirectory(run: ResolveRun, dir: string): Promise<MemoryEntry[]> {
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
 *
 * With `conditionalOnly` (the `managed-only` instruction files mode) nothing
 * loads at launch: rules without `paths:` are left out, and a `paths:` rule
 * and its imports load together, when Claude reads a matching file.
 */
async function collectRules(
  run: ResolveRun,
  root: string,
  layer: ConfigLayer,
  seen: Set<string>,
  excluded: (path: string) => boolean,
  base: string = run.folder,
  conditionalOnly = false,
): Promise<MemoryEntry[]> {
  const out: MemoryEntry[] = [];
  const imports: MemoryEntry[] = [];

  for (const path of await listRuleFiles(run, root)) {
    if (seen.has(path) || excluded(path)) continue;
    const content = await readText(run, path);
    if (content === null) continue;
    const globs = frontmatterList(parseFrontmatterFields(content), "paths");
    const conditional = globs.length > 0;
    if (conditionalOnly && !conditional) continue;
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
    if (conditionalOnly) {
      if (matches) imports.push(...(await collectImports(run, entry, seen, 1)));
      continue;
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
 * The managed `claudeMd` setting as an `inline` entry whose `path` is the
 * managed settings file that set it. Docs (/settings-reference#claudemd,
 * /memory#deploy-organization-wide-claude-md), Claude Code 2.1.280: honored
 * in managed settings only, loaded like a managed CLAUDE.md, ahead of user and
 * project CLAUDE.md, and never excluded by `claudeMdExcludes`.
 */
function managedInlineEntry(run: ResolveRun, settings: SettingsEntry[]): MemoryEntry | null {
  const setting = effectiveSetting<string | undefined>(settings, "claudeMd", {
    parse: asString,
    default: undefined,
    layers: ["managed"],
  });
  if (setting.note) run.diagnostics.push(`claudeMd ${setting.note}`);
  if (setting.value === undefined || !setting.source) return null;
  const entry: MemoryEntry = {
    path: setting.source.path,
    layer: "managed",
    kind: "inline",
    content: setting.value,
    bytes: new TextEncoder().encode(setting.value).length,
    reason: REASON_MANAGED_INLINE,
    loading: "always",
    scopedToFile: false,
  };
  const summary = summarize(setting.value);
  if (summary) entry.summary = summary;
  return entry;
}

/**
 * Every CLAUDE.md, AGENTS.md, rule, import and memory file that applies,
 * lowest precedence first.
 *
 * Besides the project folder itself, Claude Code 2.1.280 loads `CLAUDE.md`,
 * `.claude/CLAUDE.md`, `.claude/rules` and `CLAUDE.local.md` from every
 * directory above it, up to but not including the filesystem root — past the
 * git root too. Below it, a folder's `CLAUDE.md`, `.claude/CLAUDE.md` and
 * `CLAUDE.local.md` load when Claude reads a file there.
 *
 * Which of those load, and whether `AGENTS.md` does, follows the built-in
 * `agents-md` plugin's `instructionFiles` option (docs: /memory#agents-md,
 * Claude Code 2.1.277+; checked against 2.1.280 with `/context` and by asking
 * the model which files it saw):
 *
 * - `claude-md-or-agents-md` (default): when no `CLAUDE.md`,
 *   `.claude/CLAUDE.md` or `CLAUDE.local.md` is in the project folder or above
 *   it, every `AGENTS.md` and `.claude/AGENTS.md` there loads instead. A file
 *   `claudeMdExcludes` drops does not count, nor do `~/.claude/CLAUDE.md`, the
 *   managed CLAUDE.md or `.claude/rules/`. Below the folder, a subdirectory's
 *   `AGENTS.md` loads on read when that subdirectory has none of the three
 *   CLAUDE.md files of its own (and, as above, the project has none either).
 * - `claude-md-and-agents-md`: both, each directory's CLAUDE.md files (and
 *   rules) first and its AGENTS.md after them. An AGENTS.md already pulled in
 *   by an `@import` is not read twice. Claude Code also skips one a CLAUDE.md
 *   symlinks to, but `FileSystemReader` can't see symlinks, so that pair shows
 *   up twice here.
 * - `claude-md`: CLAUDE.md files only.
 * - `managed-only`: only the managed CLAUDE.md, the managed `claudeMd` text and
 *   auto memory at launch. A subdirectory's CLAUDE.md files and `paths:`-scoped
 *   rules still load on read.
 *
 * `AGENTS.local.md`, `AGENTS.override.md` and anything under `.agents/` are
 * never read. Inside an AGENTS.md, `@imports` expand and `claudeMdExcludes`
 * applies, as for a CLAUDE.md.
 */
export async function collectMemory(
  run: ResolveRun,
  settings: SettingsEntry[] = [],
  effective?: EffectiveSettings,
): Promise<MemoryEntry[]> {
  const { p } = run;
  const mode: InstructionFilesMode =
    effective?.instructionFiles.value ?? "claude-md-or-agents-md";
  const managedOnly = mode === "managed-only";
  const isExcluded = excludesFrom(settings);
  // A directory target owns its own CLAUDE.md, so the chain starts at the
  // target itself; for a file it starts at the directory holding the file.
  const targetDir =
    run.targetKind === "directory" ? run.file : p.dirname(run.file);

  const scopedReason =
    run.targetKind === "directory" ? REASON_WHEN_READ_IN_FOLDER : REASON_WHEN_READ;

  const out: MemoryEntry[] = [];
  const seen = new Set<string>();

  const emit = async (
    list: Candidate[],
    kind: MemoryKind = "claude-md",
    reasonOverride?: string,
  ): Promise<void> => {
    for (const candidate of list) {
      if (seen.has(candidate.path) || isExcluded(candidate.path, candidate.layer)) continue;
      seen.add(candidate.path);
      const reason = reasonOverride ?? (candidate.scopedToFile ? scopedReason : REASON_ALWAYS);
      const loading: MemoryLoading = candidate.scopedToFile ? "on-read" : "always";
      const entry = await readMemoryFile(run, candidate, kind, reason, loading);
      if (!entry) continue;
      out.push(entry);
      out.push(...(await collectImports(run, entry, seen, 1)));
    }
  };

  const rules = (root: string, layer: ConfigLayer, base?: string) =>
    collectRules(run, root, layer, seen, (path) => isExcluded(path, layer), base, managedOnly);

  /** `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` in `dir`. */
  const claudeMdFiles = (dir: string, layer: ConfigLayer, localLayer: ConfigLayer): Candidate[] => {
    const scopedToFile = layer === "directory";
    return [
      { path: p.join(dir, "CLAUDE.md"), layer, scopedToFile },
      { path: p.join(dir, ".claude", "CLAUDE.md"), layer, scopedToFile },
      { path: p.join(dir, "CLAUDE.local.md"), layer: localLayer, scopedToFile },
    ];
  };

  /** Whether any of `list` exists and isn't dropped by `claudeMdExcludes`. */
  const anyPresent = async (list: Candidate[]): Promise<boolean> => {
    for (const candidate of list) {
      if (isExcluded(candidate.path, candidate.layer)) continue;
      if ((await readText(run, candidate.path)) !== null) return true;
    }
    return false;
  };

  // Parent folders, farthest first, in the order Claude Code lists them. A
  // worktree kept inside its main checkout skips that checkout's checked-in
  // files, which duplicate its own, but still gets its CLAUDE.local.md.
  const parents = ancestorsOf(p, run.folder).slice(1, -1).reverse();
  const inMainCheckout = (dir: string) =>
    run.gitRoot !== null &&
    run.gitRoot !== run.repoRoot &&
    (dir === run.repoRoot || dir.startsWith(`${run.repoRoot}${p.sep}`));
  /** The CLAUDE.md files at `dir` (the folder or one above it) that would load. */
  const launchClaudeMd = (dir: string): Candidate[] => {
    const [claudeMd, dotClaude, local] = claudeMdFiles(dir, "project", "local");
    return dir !== run.folder && inMainCheckout(dir) ? [local!] : [claudeMd!, dotClaude!, local!];
  };

  let readAgents = mode === "claude-md-and-agents-md";
  if (mode === "claude-md-or-agents-md") {
    readAgents = true;
    for (const dir of [...parents, run.folder]) {
      if (await anyPresent(launchClaudeMd(dir))) {
        readAgents = false;
        break;
      }
    }
  }
  const agentsReason =
    mode === "claude-md-and-agents-md" ? REASON_AGENTS_ALONGSIDE : REASON_AGENTS_INSTEAD;
  const agents = async (dir: string): Promise<void> => {
    if (!readAgents) return;
    await emit(
      [
        { path: p.join(dir, "AGENTS.md"), layer: "project", scopedToFile: false },
        { path: p.join(dir, ".claude", "AGENTS.md"), layer: "project", scopedToFile: false },
      ],
      "agents-md",
      agentsReason,
    );
  };

  await emit([
    { path: p.join(managedDirFor(run.platform), "CLAUDE.md"), layer: "managed", scopedToFile: false },
  ]);
  const inline = managedInlineEntry(run, settings);
  if (inline) out.push(inline);
  if (!managedOnly) {
    await emit([{ path: p.join(userClaudeDir(run), "CLAUDE.md"), layer: "user", scopedToFile: false }]);
  }
  out.push(...(await rules(p.join(userClaudeDir(run), "rules"), "user")));
  if (effective?.autoMemory.value !== false) {
    const memoryDir = autoMemoryDirectory(run, settings);
    if (memoryDir !== null) out.push(...(await collectMemoryDirectory(run, memoryDir)));
  }

  for (const dir of parents) {
    const [claudeMd, dotClaude, local] = claudeMdFiles(dir, "project", "local");
    if (!inMainCheckout(dir)) {
      if (!managedOnly) await emit([claudeMd!, dotClaude!]);
      out.push(...(await rules(p.join(dir, ".claude", "rules"), "project", dir)));
    }
    if (!managedOnly) await emit([local!]);
    if (!inMainCheckout(dir)) await agents(dir);
  }

  if (!managedOnly) await emit(claudeMdFiles(run.folder, "project", "local"));
  out.push(...(await rules(p.join(projectClaudeDir(run), "rules"), "project")));
  await agents(run.folder);

  // Subdirectories between the folder and the target load on read.
  for (const dir of descendingChain(p, run.folder, targetDir)) {
    const own = claudeMdFiles(dir, "directory", "directory");
    await emit(own);
    const nestedAgents =
      mode === "claude-md-and-agents-md" ||
      (mode === "claude-md-or-agents-md" && readAgents && !(await anyPresent(own)));
    if (!nestedAgents) continue;
    await emit(
      [{ path: p.join(dir, "AGENTS.md"), layer: "directory", scopedToFile: true }],
      "agents-md",
      mode === "claude-md-and-agents-md"
        ? `${scopedReason}, after that folder's CLAUDE.md files`
        : `${scopedReason}: no CLAUDE.md in that folder, the project folder or above it`,
    );
  }

  return out;
}
