import { type PathApi } from "./paths.js";
import { type FileSystemReader, type TargetKind } from "./types.js";

/** Everything the collectors share while one `resolveContext` call runs. */
export interface ResolveRun {
  fs: FileSystemReader;
  p: PathApi;
  platform: NodeJS.Platform;
  homeDir: string;
  /** `CLAUDE_CONFIG_DIR` when set; `undefined` means `<homeDir>/.claude`. */
  configDir?: string;
  /** Absolute, normalised project folder. */
  folder: string;
  /** Absolute, normalised target: a file, or a directory when `targetKind` says so. */
  file: string;
  /** Whether `file` is a file or a directory. */
  targetKind: TargetKind;
  /** Absolute path of the managed config directory for this platform. */
  managedDir: string;
  /** Absolute path of the managed settings file. */
  managedSettingsPath: string;
  /**
   * Nearest directory at or above `folder` holding a `.git` directory or file
   * (a worktree's root, for a worktree); `null` outside a repository.
   */
  gitRoot: string | null;
  /**
   * The main checkout's root: `gitRoot`, except in a linked worktree, where it
   * is the checkout the worktree belongs to. `folder` outside a repository.
   * Claude Code keys auto-memory and reads a second `settings.local.json` here.
   */
  repoRoot: string;
  diagnostics: string[];
}

const MANAGED_DIRS: Record<string, string> = {
  darwin: "/Library/Application Support/ClaudeCode",
  // Docs (/managed-settings): the legacy C:\\ProgramData path is no longer read.
  win32: "C:\\Program Files\\ClaudeCode",
};

export function managedDirFor(platform: NodeJS.Platform): string {
  return MANAGED_DIRS[platform] ?? "/etc/claude-code";
}

/** `~/.claude`, or `CLAUDE_CONFIG_DIR` when set. */
export function userClaudeDir(run: ResolveRun): string {
  return run.configDir ?? run.p.join(run.homeDir, ".claude");
}

/** `~/.claude.json`, or `$CLAUDE_CONFIG_DIR/.claude.json` when set. */
export function userConfigJsonPath(run: ResolveRun): string {
  return run.configDir
    ? run.p.join(run.configDir, ".claude.json")
    : run.p.join(run.homeDir, ".claude.json");
}

export function projectClaudeDir(run: ResolveRun): string {
  return run.p.join(run.folder, ".claude");
}

/** Reads a file, returning `null` when it is absent. Never throws for ENOENT. */
export async function readText(run: ResolveRun, path: string): Promise<string | null> {
  return run.fs.readFile(path);
}

/** Byte size of a file, falling back to the UTF-8 length of `content`. */
export async function sizeOf(
  run: ResolveRun,
  path: string,
  content: string,
): Promise<number> {
  const reported = await run.fs.fileSize(path);
  if (typeof reported === "number") return reported;
  return new TextEncoder().encode(content).length;
}

/** Lists a directory, returning `[]` when it is absent. */
export async function listDir(
  run: ResolveRun,
  path: string,
): Promise<{ name: string; isDirectory: boolean }[]> {
  return (await run.fs.readDir(path)) ?? [];
}

/** Directories from `from` up to the filesystem root, nearest first, `from` included. */
export function ancestorsOf(p: PathApi, from: string): string[] {
  const out: string[] = [];
  let current = from;
  while (true) {
    out.push(current);
    const parent = p.dirname(current);
    if (parent === current) return out;
    current = parent;
  }
}

/**
 * Finds the git root above `folder` and, for a linked worktree, the main
 * checkout it belongs to. A worktree's `.git` is a file (`gitdir: <path>`);
 * that directory's `commondir` points at the main `.git`, whose parent is the
 * main checkout. A submodule's gitdir has no `commondir`, so it is its own root.
 */
export async function locateRepository(
  fs: FileSystemReader,
  p: PathApi,
  folder: string,
): Promise<{ gitRoot: string | null; repoRoot: string }> {
  for (const dir of ancestorsOf(p, folder)) {
    const dotGit = p.join(dir, ".git");
    if ((await fs.readDir(dotGit)) !== null) return { gitRoot: dir, repoRoot: dir };

    const pointer = await fs.readFile(dotGit);
    if (pointer === null) continue;
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(pointer);
    if (!match) return { gitRoot: dir, repoRoot: dir };
    const gitDir = p.resolve(dir, match[1]!);
    const common = await fs.readFile(p.join(gitDir, "commondir"));
    if (common === null) return { gitRoot: dir, repoRoot: dir };
    const commonDir = p.resolve(gitDir, common.trim());
    return { gitRoot: dir, repoRoot: p.dirname(commonDir) };
  }
  return { gitRoot: null, repoRoot: folder };
}

/**
 * Where Claude Code looks for project skills, subagents and legacy commands:
 * `folder` and every directory above it up to the git root, nearest first.
 * Outside a repository, just `folder`. Checked against Claude Code 2.1.280.
 */
export function projectDirsUpToGitRoot(run: ResolveRun): string[] {
  if (run.gitRoot === null) return [run.folder];
  const out: string[] = [];
  for (const dir of ancestorsOf(run.p, run.folder)) {
    out.push(dir);
    if (dir === run.gitRoot) break;
  }
  return out;
}
