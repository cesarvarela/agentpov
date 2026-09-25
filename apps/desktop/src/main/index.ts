import { stat } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell, webContents } from "electron";
import { resolveContext } from "@agentview/core";

import type {
  FileNode,
  ReadFileResult,
  RemoteInfo,
  ResolvedContext,
  SshPrompt,
  TargetKind,
} from "../shared/ipc";
import {
  backendFor,
  closeAllRemotes,
  connectRemote,
  openRemote,
  resetToLocal,
} from "./backends";
import { startAskpass, stopAskpass } from "./ssh/askpass";
import { listSshHosts } from "./ssh/config";

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

  const contentsId = window.webContents.id;
  window.on("closed", () => resetToLocal(contentsId));

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
  // Packaged builds get build/icon.icns from electron-builder; dev runs inside
  // the stock Electron.app, so swap its dock icon for ours.
  if (isDev) app.dock?.setIcon(join(__dirname, "../../build/icon.png"));

  ipcMain.handle("app:getName", () => "agentview");

  ipcMain.handle("dialog:openFolder", async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    resetToLocal(event.sender.id);
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    "fs:openLocal",
    async (event, folder: string): Promise<string> => {
      const info = await stat(folder).catch(() => null);
      if (!info?.isDirectory()) throw new Error(`No folder at ${folder}`);
      resetToLocal(event.sender.id);
      return folder;
    },
  );

  ipcMain.handle("ssh:listHosts", (): Promise<string[]> => listSshHosts());

  ipcMain.handle(
    "ssh:connect",
    (event, host: string): Promise<RemoteInfo> => connectRemote(host, event.sender.id),
  );

  ipcMain.handle(
    "ssh:openFolder",
    (event, host: string, folder: string): Promise<RemoteInfo & { folder: string }> =>
      openRemote(event.sender.id, host, folder),
  );

  const prompts = new Map<number, (value: string | null) => void>();

  ipcMain.handle("ssh:answer", (_event, id: number, value: string | null) => {
    prompts.get(id)?.(value);
  });

  startAskpass(
    (prompt: SshPrompt, windowId) =>
      new Promise<string | null>((resolve) => {
        const requester = windowId === null ? undefined : webContents.fromId(windowId);
        const contents =
          (requester && !requester.isDestroyed() ? requester : undefined) ??
          (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents;
        if (!contents) {
          resolve(null);
          return;
        }

        // A prompt nobody can answer any more is a cancel; otherwise ssh (and
        // every later connect to that host) would wait on it forever.
        const cancel = () => settle(null);
        const onNavigate = (details: { isSameDocument: boolean; isMainFrame: boolean }) => {
          if (details.isMainFrame && !details.isSameDocument) cancel();
        };
        const settle = (value: string | null) => {
          prompts.delete(prompt.id);
          contents.off("destroyed", cancel);
          contents.off("render-process-gone", cancel);
          contents.off("did-start-navigation", onNavigate);
          resolve(value);
        };
        contents.once("destroyed", cancel);
        contents.once("render-process-gone", cancel);
        contents.on("did-start-navigation", onNavigate);
        prompts.set(prompt.id, settle);
        contents.send("ssh:prompt", prompt);
      }),
  );

  ipcMain.handle(
    "fs:listTree",
    (event, folder: string): Promise<FileNode> =>
      backendFor(event.sender.id).listTree(folder),
  );

  ipcMain.handle(
    "context:resolve",
    (
      event,
      folder: string,
      target: string,
      targetKind: TargetKind = "file",
    ): Promise<ResolvedContext> => {
      const backend = backendFor(event.sender.id);
      return resolveContext(folder, target, {
        fs: backend.fs,
        homeDir: backend.homeDir,
        platform: backend.platform,
        targetKind,
      });
    },
  );

  ipcMain.handle(
    "fs:readFile",
    (event, path: string): Promise<ReadFileResult> =>
      backendFor(event.sender.id).readFile(path),
  );

  ipcMain.handle(
    "shell:openInEditor",
    async (event, path: string): Promise<string> => {
      const { host } = backendFor(event.sender.id);
      if (host) return `${path} is on ${host}`;
      return shell.openPath(path);
    },
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  closeAllRemotes();
  stopAskpass();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
