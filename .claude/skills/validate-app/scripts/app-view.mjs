#!/usr/bin/env node
// What the app shows: runs the same resolveContext call the desktop main
// process makes (apps/desktop/src/main/index.ts, "context:resolve") and prints
// it as compact JSON, file contents dropped.
//
// Usage: node app-view.mjs <folder> [target] [--dir]
//   target defaults to <folder>; --dir resolves it as a directory.

import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const core = await import(
  pathToFileURL(resolve(repo, "packages/core/dist/index.js")).href
).catch(() => {
  console.error("packages/core/dist missing: run `pnpm -F @agentpov/core build`");
  process.exit(1);
});

const args = process.argv.slice(2);
const dir = args.includes("--dir");
const [folderArg, targetArg] = args.filter((a) => a !== "--dir");
if (!folderArg) {
  console.error("usage: node app-view.mjs <folder> [target] [--dir]");
  process.exit(1);
}
const folder = resolve(folderArg);
const target = targetArg ? resolve(folder, targetArg) : folder;

const ctx = await core.resolveContext(folder, target, {
  fs: core.createNodeFileSystem(),
  homeDir: homedir(),
  targetKind: dir || !targetArg ? "directory" : "file",
});

const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

console.log(
  JSON.stringify(
    {
      folder: ctx.folder,
      target: ctx.file,
      targetKind: ctx.targetKind,
      memory: ctx.memory.map((m) =>
        pick(m, ["path", "layer", "kind", "loading", "reason", "scopedToFile", "appliesToGlobs", "importedBy", "bytes"]),
      ),
      settings: ctx.settings.map((s) => ({ path: s.path, layer: s.layer, keys: Object.keys(s.values) })),
      permissions: ctx.permissions,
      hooks: ctx.hooks,
      skills: ctx.skills.map((s) => pick(s, ["name", "shortName", "source", "plugin", "subdir", "path", "shadowedBy"])),
      agents: ctx.agents.map((a) => pick(a, ["name", "path", "layer", "model", "shadowedBy"])),
      mcpServers: ctx.mcpServers.map((m) => pick(m, ["name", "path", "layer", "transport", "state", "reason"])),
      diagnostics: ctx.diagnostics,
    },
    null,
    2,
  ),
);
