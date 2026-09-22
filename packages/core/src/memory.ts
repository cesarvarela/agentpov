import {
  listDir,
  managedDirFor,
  projectClaudeDir,
  readText,
  sizeOf,
  userClaudeDir,
  type ResolveRun,
} from "./context.js";
import { descendingChain, toAbsolute } from "./paths.js";
import { type ConfigLayer, type MemoryEntry } from "./types.js";

const MAX_IMPORT_DEPTH = 5;

export const REASON_ALWAYS = "always loaded";
export const REASON_WHEN_READ = "loaded when this file is read";
export const REASON_WHEN_READ_IN_FOLDER = "loaded when files in this folder are read";
export const REASON_RECALLED = "recalled on demand";

interface Candidate {
  path: string;
  layer: ConfigLayer;
  scopedToFile: boolean;
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
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const token = trimTrailingPunctuation(match[1]!);
      if (!looksLikePath(token)) continue;
      results.push({ raw: token, line: index + 1 });
    }
  }
  return results;
}

function trimTrailingPunctuation(token: string): string {
  return token.replace(/[,;:)\]}]+$/, "");
}

function looksLikePath(token: string): boolean {
  if (token.length === 0) return false;
  if (token.startsWith("~/") || token.startsWith("./") || token.startsWith("../")) {
    return true;
  }
  if (token.startsWith("/")) return true;
  if (token.includes("/")) return true;
  return /\.(?:md|markdown|txt)$/i.test(token);
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
    scopedToFile: candidate.scopedToFile,
  };
  if (extra) {
    entry.importedBy = extra.importedBy;
    entry.importedAtLine = extra.importedAtLine;
  }
  return entry;
}

async function collectImports(
  run: ResolveRun,
  parent: MemoryEntry,
  seen: Set<string>,
  depth: number,
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
      { path: target, layer: parent.layer, scopedToFile: parent.scopedToFile },
      "import",
      `inlined at line ${reference.line} of ${parentName}`,
      { importedBy: parent.path, importedAtLine: reference.line },
    );
    if (!entry) {
      run.diagnostics.push(
        `${target}: imported at line ${reference.line} of ${parent.path} but not found`,
      );
      continue;
    }
    out.push(entry);
    out.push(...(await collectImports(run, entry, seen, depth + 1)));
  }
  return out;
}

/** `/Users/x/proj` → `-Users-x-proj`. */
export function projectSlug(folder: string, platform: NodeJS.Platform): string {
  const withSeparators =
    platform === "win32" ? folder.replace(/[\\:]/g, "-") : folder;
  return withSeparators.replace(/\//g, "-");
}

async function collectMemoryDirectory(run: ResolveRun): Promise<MemoryEntry[]> {
  const slug = projectSlug(run.folder, run.platform);
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
    );
    if (entry) out.push(entry);
  }
  return out;
}

/** Every CLAUDE.md, import and memory file that applies, lowest precedence first. */
export async function collectMemory(run: ResolveRun): Promise<MemoryEntry[]> {
  const { p } = run;
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
      if (seen.has(candidate.path)) continue;
      seen.add(candidate.path);
      const reason = candidate.scopedToFile ? scopedReason : REASON_ALWAYS;
      const entry = await readMemoryFile(run, candidate, "claude-md", reason);
      if (!entry) continue;
      out.push(entry);
      out.push(...(await collectImports(run, entry, seen, 1)));
    }
  };

  await emit(candidates);
  out.push(...(await collectMemoryDirectory(run)));
  await emit(projectCandidates);
  await emit(directoryCandidates);

  return out;
}
