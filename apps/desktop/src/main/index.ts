import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { createNodeFileSystem, resolveContext } from "@agentview/core";

import {
  READ_FILE_MAX_BYTES,
  type FileNode,
  type ReadFileResult,
  type ResolvedContext,
  type TargetKind,
} from "../shared/ipc";
import { listTree } from "./tree";

const isDev = !app.isPackaged;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#101216",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.once("ready-to-show", () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (isDev && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

app.whenReady().then(() => {
  ipcMain.handle("app:getName", () => "agentview");

  ipcMain.handle("dialog:openFolder", async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    "fs:listTree",
    (_event, folder: string): Promise<FileNode> => listTree(folder),
  );

  ipcMain.handle(
    "context:resolve",
    (
      _event,
      folder: string,
      target: string,
      targetKind: TargetKind = "file",
    ): Promise<ResolvedContext> =>
      resolveContext(folder, target, {
        fs: createNodeFileSystem(),
        homeDir: homedir(),
        targetKind,
      }),
  );

  ipcMain.handle(
    "fs:readFile",
    async (_event, path: string): Promise<ReadFileResult> => {
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
  );

  ipcMain.handle(
    "shell:openInEditor",
    async (_event, path: string): Promise<string> => shell.openPath(path),
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
