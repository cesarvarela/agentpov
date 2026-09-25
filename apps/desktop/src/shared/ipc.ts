/**
 * Types shared by the main process, the preload bridge and the renderer.
 *
 * Keep this file dependency-free apart from type-only imports: it is pulled
 * into both the node and the web tsconfig.
 */
import type { ResolvedContext, TargetKind } from "@agentpov/core";

export type { ResolvedContext, TargetKind };

/** Why a node in the tree is interesting to an agent. */
export type FileMark = "instructions" | "mcp" | "deny";

/** One entry of the project tree returned by `fs:listTree`. */
export interface FileNode {
  name: string;
  /** Absolute path. */
  path: string;
  kind: "file" | "dir";
  marks: FileMark[];
  /** Present for directories that were walked (absent past the depth cap). */
  children?: FileNode[];
}

/** Maximum number of bytes `fs:readFile` will return. */
export const READ_FILE_MAX_BYTES = 200 * 1024;

export interface ReadFileResult {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
}

/** An SSH host the window is connected to, with the remote user's home and OS. */
export interface RemoteInfo {
  host: string;
  homeDir: string;
  platform: NodeJS.Platform;
}

/** A question ssh asks while connecting: passphrase, password, 2FA or host key. */
export interface SshPrompt {
  id: number;
  host: string;
  /** ssh's own prompt text, shown verbatim. */
  message: string;
}
