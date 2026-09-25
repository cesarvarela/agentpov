import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { createNodeFileSystem, type FileSystemReader } from "@agentview/core";

import {
  READ_FILE_MAX_BYTES,
  type FileNode,
  type ReadFileResult,
} from "../shared/ipc";
import {
  decode,
  parseEntries,
  REMOTE_MAX_DEPTH,
  RemoteHost,
  type RemoteInfo,
} from "./ssh/session";
import { buildTree, listTree } from "./tree";

/** Where a window's project lives: this machine or one SSH host. */
export interface Backend {
  /** SSH host, or null for the local filesystem. */
  host: string | null;
  homeDir: string;
  platform: NodeJS.Platform;
  fs: FileSystemReader;
  listTree(folder: string): Promise<FileNode>;
  readFile(path: string): Promise<ReadFileResult>;
}

export const localBackend: Backend = {
  host: null,
  homeDir: homedir(),
  platform: process.platform,
  fs: createNodeFileSystem(),
  listTree,
  async readFile(path) {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Not a file: ${path}`);

    const buffer = await readFile(path);
    const truncated = buffer.byteLength > READ_FILE_MAX_BYTES;
    const slice = truncated ? buffer.subarray(0, READ_FILE_MAX_BYTES) : buffer;

    return {
      path,
      content: slice.toString("utf8"),
      bytes: info.size,
      truncated,
    };
  },
};

function remoteFileSystem(remote: RemoteHost): FileSystemReader {
  return {
    async readFile(path) {
      const fields = await remote.request("read", path);
      return fields ? decode(fields[0]) : null;
    },
    async readDir(path) {
      const fields = await remote.request("list", path);
      if (!fields) return null;
      return parseEntries(fields[0]).map((entry) => ({
        name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
        isDirectory: entry.isDirectory,
      }));
    },
    async fileSize(path) {
      const fields = await remote.request("size", path);
      return fields ? Number(fields[0]) : null;
    },
  };
}

function remoteBackend(remote: RemoteHost, info: RemoteInfo): Backend {
  return {
    host: remote.host,
    homeDir: info.homeDir,
    platform: info.platform,
    fs: remoteFileSystem(remote),
    async listTree(folder) {
      const fields = await remote.request("tree", folder, false);
      if (!fields) throw new Error(`Not a folder on ${remote.host}: ${folder}`);
      return buildTree(folder, parseEntries(fields[0]), REMOTE_MAX_DEPTH);
    },
    async readFile(path) {
      const fields = await remote.request("head", path);
      if (!fields) throw new Error(`Not a file on ${remote.host}: ${path}`);
      const bytes = Number(fields[0]);
      return {
        path,
        content: decode(fields[1]),
        bytes,
        truncated: bytes > READ_FILE_MAX_BYTES,
      };
    },
  };
}

const hosts = new Map<string, RemoteHost>();
const windows = new Map<number, Backend>();

function remoteHost(host: string): RemoteHost {
  let remote = hosts.get(host);
  if (!remote) {
    remote = new RemoteHost(host);
    hosts.set(host, remote);
  }
  return remote;
}

/** The backend serving a window (keyed by webContents id); local by default. */
export function backendFor(windowId: number): Backend {
  return windows.get(windowId) ?? localBackend;
}

/** Back to the local filesystem, after opening a local folder or closing the window. */
export function resetToLocal(windowId: number): void {
  windows.delete(windowId);
}

/** Connects to `host`, authenticating through the askpass bridge if needed. */
export async function connectRemote(host: string): Promise<RemoteInfo> {
  const remote = remoteHost(host);
  try {
    return await remote.connect();
  } catch (error) {
    hosts.delete(host);
    throw error;
  }
}

/**
 * Points a window at `folder` on `host`. `~` and `~/…` expand to the remote
 * home; the returned path is absolute.
 */
export async function openRemote(
  windowId: number,
  host: string,
  folder: string,
): Promise<RemoteInfo & { folder: string }> {
  const remote = remoteHost(host);
  const info = await remote.connect();

  let path = folder.trim();
  if (path === "~") path = info.homeDir;
  else if (path.startsWith("~/")) path = `${info.homeDir}/${path.slice(2)}`;
  if (!path.startsWith("/")) throw new Error("Use an absolute path or one starting with ~/");
  if (path.length > 1) path = path.replace(/\/+$/, "");

  if (!(await remote.request("isdir", path, false))) {
    throw new Error(`No folder at ${path} on ${host}`);
  }
  windows.set(windowId, remoteBackend(remote, info));
  return { ...info, folder: path };
}

export function closeAllRemotes(): void {
  for (const remote of hosts.values()) remote.close();
  hosts.clear();
}
