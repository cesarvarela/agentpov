// Renders build/icon.svg to build/icon.icns (macOS only: uses sips + iconutil)
// and build/icon.png, which the main process sets as the dock icon in dev.
// Run with `pnpm -F @agentview/desktop make-icon`; it launches Electron headless
// so no extra image tooling is needed.
const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { app, BrowserWindow } = require("electron");

const SIZE = 1024;
const buildDir = join(__dirname, "..", "build");

app.dock?.hide();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });

  const svg = readFileSync(join(buildDir, "icon.svg"), "utf8");
  const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const png = image.resize({ width: SIZE, height: SIZE, quality: "best" }).toPNG();

  const work = mkdtempSync(join(tmpdir(), "agentview-icon-"));
  const master = join(work, "icon-1024.png");
  writeFileSync(master, png);
  writeFileSync(join(buildDir, "icon.png"), png);

  const iconset = join(work, "icon.iconset");
  execFileSync("mkdir", ["-p", iconset]);
  for (const base of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const px = base * scale;
      const name = scale === 1 ? `icon_${base}x${base}.png` : `icon_${base}x${base}@2x.png`;
      execFileSync("sips", ["-z", String(px), String(px), master, "--out", join(iconset, name)], {
        stdio: "ignore",
      });
    }
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(buildDir, "icon.icns")]);
  rmSync(work, { recursive: true, force: true });

  console.log(`wrote ${join(buildDir, "icon.icns")} and icon.png`);
  app.quit();
});
