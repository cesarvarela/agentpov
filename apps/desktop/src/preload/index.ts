import { homedir } from "node:os";
import { contextBridge, ipcRenderer } from "electron";

import type {
  FileNode,
  ReadFileResult,
  RemoteInfo,
  ResolvedContext,
  SshPrompt,
  TargetKind,
} from "../shared/ipc";

const api = {
  getAppName: (): Promise<string> => ipcRenderer.invoke("app:getName"),
  openFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:openFolder"),
  /** Reopens a local folder without the picker; rejects when it is gone. */
  openLocalFolder: (folder: string): Promise<string> =>
    ipcRenderer.invoke("fs:openLocal", folder),
  /** Host aliases from ~/.ssh/config. */
  listSshHosts: (): Promise<string[]> => ipcRenderer.invoke("ssh:listHosts"),
  /** Connects to an SSH host; rejects with ssh's error text. */
  connectRemote: (host: string): Promise<RemoteInfo> =>
    ipcRenderer.invoke("ssh:connect", host),
  /**
   * Points this window at a folder on `host` (`~/…` allowed). Later tree,
   * context and file calls read from that host until a local folder is opened.
   */
  openRemoteFolder: (
    host: string,
    folder: string,
  ): Promise<RemoteInfo & { folder: string }> =>
    ipcRenderer.invoke("ssh:openFolder", host, folder),
  /** Subscribes to ssh prompts; returns the unsubscribe function. */
  onSshPrompt: (listener: (prompt: SshPrompt) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, prompt: SshPrompt) =>
      listener(prompt);
    ipcRenderer.on("ssh:prompt", handler);
    return () => ipcRenderer.removeListener("ssh:prompt", handler);
  },
  /** Answers a prompt; null cancels it. */
  answerSshPrompt: (id: number, value: string | null): Promise<void> =>
    ipcRenderer.invoke("ssh:answer", id, value),
  /** Recursive tree of `folder`, noise directories skipped, depth-capped. */
  listTree: (folder: string): Promise<FileNode> =>
    ipcRenderer.invoke("fs:listTree", folder),
  /** Everything an agent sees for `target` (a file or a folder) inside `folder`. */
  resolveContext: (
    folder: string,
    target: string,
    targetKind: TargetKind,
  ): Promise<ResolvedContext> =>
    ipcRenderer.invoke("context:resolve", folder, target, targetKind),
  /** File contents, capped at 200 KB. */
  readFile: (path: string): Promise<ReadFileResult> =>
    ipcRenderer.invoke("fs:readFile", path),
  /** Opens the path in the OS default handler; resolves to "" on success. */
  openInEditor: (path: string): Promise<string> =>
    ipcRenderer.invoke("shell:openInEditor", path),
  platform: process.platform as NodeJS.Platform,
  /** Absolute home directory, so the renderer can print `~/...` paths. */
  homeDir: homedir(),
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
};

export type AgentviewApi = typeof api;

contextBridge.exposeInMainWorld("agentview", api);
