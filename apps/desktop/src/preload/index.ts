import { homedir } from "node:os";
import { contextBridge, ipcRenderer } from "electron";

import type { FileNode, ReadFileResult, ResolvedContext } from "../shared/ipc";

const api = {
  getAppName: (): Promise<string> => ipcRenderer.invoke("app:getName"),
  openFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:openFolder"),
  /** Recursive tree of `folder`, noise directories skipped, depth-capped. */
  listTree: (folder: string): Promise<FileNode> =>
    ipcRenderer.invoke("fs:listTree", folder),
  /** Everything an agent sees for `file` inside `folder`. */
  resolveContext: (folder: string, file: string): Promise<ResolvedContext> =>
    ipcRenderer.invoke("context:resolve", folder, file),
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
