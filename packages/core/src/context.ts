import { type PathApi } from "./paths.js";
import { type FileSystemReader } from "./types.js";

/** Everything the collectors share while one `resolveContext` call runs. */
export interface ResolveRun {
  fs: FileSystemReader;
  p: PathApi;
  platform: NodeJS.Platform;
  homeDir: string;
  /** Absolute, normalised project folder. */
  folder: string;
  /** Absolute, normalised selected file. */
  file: string;
  /** Absolute path of the managed config directory for this platform. */
  managedDir: string;
  /** Absolute path of the managed settings file. */
  managedSettingsPath: string;
  diagnostics: string[];
}

const MANAGED_DIRS: Record<string, string> = {
  darwin: "/Library/Application Support/ClaudeCode",
  win32: "C:\\ProgramData\\ClaudeCode",
};

export function managedDirFor(platform: NodeJS.Platform): string {
  return MANAGED_DIRS[platform] ?? "/etc/claude-code";
}

export function userClaudeDir(run: ResolveRun): string {
  return run.p.join(run.homeDir, ".claude");
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
