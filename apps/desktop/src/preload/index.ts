import { contextBridge, ipcRenderer } from "electron";

const api = {
  getAppName: (): Promise<string> => ipcRenderer.invoke("app:getName"),
  openFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:openFolder"),
  platform: process.platform as NodeJS.Platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
};

export type AgentviewApi = typeof api;

contextBridge.exposeInMainWorld("agentview", api);
