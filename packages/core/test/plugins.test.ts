import { describe, expect, it } from "vitest";

import { resolveContext, type ResolvedContext } from "../src/index.js";
import { parseInstalledPlugins } from "../src/plugins.js";
import { memfs } from "./memfs.js";

const HOME = "/home/dev";
const FOLDER = "/projects/acme/shop-api";
const PLUGINS = `${HOME}/.claude/plugins`;
const MANAGED = "/etc/claude-code/managed-settings.json";

function run(files: Record<string, string>, configDir?: string): Promise<ResolvedContext> {
  return resolveContext(FOLDER, FOLDER, {
    fs: memfs(files),
    homeDir: HOME,
    platform: "linux",
    targetKind: "directory",
    ...(configDir ? { configDir } : {}),
  });
}

const manifest = (name: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ name, version: "1.0.0", ...extra });

/** `installed_plugins.json` as Claude Code 2.1.280 writes it. */
function installed(...ids: string[]): string {
  const plugins: Record<string, unknown> = {};
  for (const id of ids) {
    const [name, marketplace] = id.split("@");
    plugins[id] = [
      {
        scope: "user",
        installPath: `${PLUGINS}/cache/${marketplace}/${name}/1.0.0`,
        version: "1.0.0",
        installedAt: "2026-09-26T00:00:00.000Z",
        lastUpdated: "2026-09-26T00:00:00.000Z",
      },
    ];
  }
  return JSON.stringify({ version: 2, plugins });
}

const cached = (id: string): string => {
  const [name, marketplace] = id.split("@");
  return `${PLUGINS}/cache/${marketplace}/${name}/1.0.0`;
};

describe("installed_plugins.json", () => {
  it("reads version 2 install records (arrays of objects)", () => {
    const records = parseInstalledPlugins(JSON.parse(installed("demo@mkt")));
    expect(records).toEqual([
      expect.objectContaining({
        key: "demo@mkt",
        name: "demo",
        marketplace: "mkt",
        path: `${PLUGINS}/cache/mkt/demo/1.0.0`,
        version: "1.0.0",
        scope: "user",
      }),
    ]);
  });

  it("still accepts the older shapes", () => {
    const records = parseInstalledPlugins({
      plugins: { "a@m": { version: "1" }, "b@m": true, legacy: ["c"], "d@m": false },
    });
    expect(records.map((r) => r.key)).toEqual(["a@m", "b@m", "c@legacy"]);
  });
});

describe("plugins", () => {
  it("lists an installed plugin, enabled by default, rooted at its install path", async () => {
    const result = await run({
      [`${PLUGINS}/installed_plugins.json`]: installed("demo@mkt"),
      [`${cached("demo@mkt")}/.claude-plugin/plugin.json`]: manifest("demo", { description: "Fixture" }),
    });
    expect(result.plugins).toEqual([
      expect.objectContaining({
        id: "demo@mkt",
        name: "demo",
        origin: "marketplace",
        marketplace: "mkt",
        root: cached("demo@mkt"),
        version: "1.0.0",
        description: "Fixture",
        enabled: true,
        layer: "user",
      }),
    ]);
  });

  it("loads a relative-path plugin from a local-directory marketplace in place", async () => {
    const market = "/work/my-market";
    const result = await run({
      [`${PLUGINS}/installed_plugins.json`]: installed("demo@local"),
      [`${cached("demo@local")}/.claude-plugin/plugin.json`]: manifest("demo"),
      [`${PLUGINS}/known_marketplaces.json`]: JSON.stringify({
        local: { source: { source: "directory", path: market }, installLocation: market },
      }),
      [`${market}/.claude-plugin/marketplace.json`]: JSON.stringify({
        name: "local",
        plugins: [{ name: "demo", source: "./plugins/demo" }],
      }),
      [`${market}/plugins/demo/.claude-plugin/plugin.json`]: manifest("demo"),
    });
    expect(result.plugins[0]!.root).toBe(`${market}/plugins/demo`);
  });

  it("lets managed enabledPlugins beat a local true", async () => {
    const result = await run({
      [`${PLUGINS}/installed_plugins.json`]: installed("demo@mkt"),
      [`${cached("demo@mkt")}/.claude-plugin/plugin.json`]: manifest("demo"),
      [MANAGED]: JSON.stringify({ enabledPlugins: { "demo@mkt": false } }),
      [`${FOLDER}/.claude/settings.local.json`]: JSON.stringify({ enabledPlugins: { "demo@mkt": true } }),
    });
    const [plugin] = result.plugins;
    expect(plugin!.enabled).toBe(false);
    expect(plugin!.stateSource).toBe(MANAGED);
  });

  it("lets local settings turn off a project-enabled plugin", async () => {
    const local = `${FOLDER}/.claude/settings.local.json`;
    const result = await run({
      [`${PLUGINS}/installed_plugins.json`]: installed("demo@mkt"),
      [`${cached("demo@mkt")}/.claude-plugin/plugin.json`]: manifest("demo"),
      [`${FOLDER}/.claude/settings.json`]: JSON.stringify({ enabledPlugins: { "demo@mkt": true } }),
      [local]: JSON.stringify({ enabledPlugins: { "demo@mkt": false } }),
    });
    expect(result.plugins[0]).toMatchObject({ enabled: false, stateSource: local });
  });

  it("honours manifest defaultEnabled: false when no settings mention the plugin", async () => {
    const result = await run({
      [`${PLUGINS}/installed_plugins.json`]: installed("demo@mkt"),
      [`${cached("demo@mkt")}/.claude-plugin/plugin.json`]: manifest("demo", { defaultEnabled: false }),
    });
    expect(result.plugins[0]!.enabled).toBe(false);
    expect(result.plugins[0]!.reason).toContain("defaultEnabled");
  });

  it("reports a settings-only plugin with no files as not installed", async () => {
    const result = await run({
      [`${FOLDER}/.claude/settings.json`]: JSON.stringify({ enabledPlugins: { "ghost@mkt": true } }),
    });
    expect(result.plugins).toEqual([
      expect.objectContaining({ id: "ghost@mkt", enabled: false }),
    ]);
    expect(result.plugins[0]!.reason).toContain("not installed");
  });

  it("ignores reserved origins in enabledPlugins (builtin, inline)", async () => {
    const result = await run({
      [`${HOME}/.claude/settings.json`]: JSON.stringify({
        enabledPlugins: { "agents-md@builtin": true, "x@inline": false },
      }),
    });
    expect(result.plugins).toEqual([]);
  });

  it("finds user and project skills-dir plugins; the user copy wins a name clash", async () => {
    const result = await run({
      [`${HOME}/.claude/skills/pz/.claude-plugin/plugin.json`]: manifest("pz"),
      [`${FOLDER}/.claude/skills/pz-copy/.claude-plugin/plugin.json`]: manifest("pz"),
      [`${FOLDER}/.claude/skills/team/.claude-plugin/plugin.json`]: manifest("team"),
      [`${FOLDER}/.claude/skills/.hidden/.claude-plugin/plugin.json`]: manifest("hidden"),
    });
    const byRoot = Object.fromEntries(result.plugins.map((p) => [p.root, p]));
    expect(byRoot[`${HOME}/.claude/skills/pz`]).toMatchObject({ id: "pz@skills-dir", layer: "user", enabled: true });
    expect(byRoot[`${FOLDER}/.claude/skills/pz-copy`]).toMatchObject({ layer: "project", enabled: false });
    expect(byRoot[`${FOLDER}/.claude/skills/pz-copy`]!.reason).toContain("already taken");
    expect(byRoot[`${FOLDER}/.claude/skills/team`]).toMatchObject({ id: "team@skills-dir", enabled: true });
    expect(result.plugins.some((p) => p.name === "hidden")).toBe(false);
  });

  it("only reads skills-dir plugins from the folder itself, not its parents", async () => {
    const result = await run({
      [`/projects/acme/.git/HEAD`]: "ref: refs/heads/main",
      [`/projects/acme/.claude/skills/up/.claude-plugin/plugin.json`]: manifest("up"),
    });
    expect(result.plugins).toEqual([]);
  });

  it("lets an installed marketplace plugin beat a skills-dir plugin of the same name", async () => {
    const result = await run({
      [`${PLUGINS}/installed_plugins.json`]: installed("pz@mkt"),
      [`${cached("pz@mkt")}/.claude-plugin/plugin.json`]: manifest("pz"),
      [`${HOME}/.claude/skills/pz/.claude-plugin/plugin.json`]: manifest("pz"),
    });
    expect(result.plugins.find((p) => p.id === "pz@mkt")!.enabled).toBe(true);
    expect(result.plugins.find((p) => p.id === "pz@skills-dir")!.enabled).toBe(false);
  });

  it("reads synced plugins and turns them off with syncClaudeAiPlugins: false", async () => {
    const files = {
      [`${PLUGINS}/synced/bucket-1/helper/.claude-plugin/plugin.json`]: manifest("helper"),
    };
    expect((await run(files)).plugins).toEqual([
      expect.objectContaining({ id: "helper@synced", origin: "synced", enabled: true }),
    ]);
    const off = await run({
      ...files,
      [`${HOME}/.claude/settings.json`]: JSON.stringify({ syncClaudeAiPlugins: false }),
    });
    expect(off.plugins[0]!.enabled).toBe(false);
  });

  it("reads plugins from CLAUDE_CONFIG_DIR instead of ~/.claude", async () => {
    const config = "/tmp/isolated";
    const result = await run(
      {
        [`${config}/plugins/installed_plugins.json`]: JSON.stringify({
          version: 2,
          plugins: { "demo@mkt": [{ scope: "user", installPath: `${config}/plugins/cache/mkt/demo/1.0.0`, version: "1.0.0" }] },
        }),
        [`${config}/plugins/cache/mkt/demo/1.0.0/.claude-plugin/plugin.json`]: manifest("demo"),
        [`${PLUGINS}/installed_plugins.json`]: installed("other@mkt"),
      },
      config,
    );
    expect(result.plugins.map((p) => p.id)).toEqual(["demo@mkt"]);
  });
});

describe("effective settings", () => {
  it("takes managed over local over project over user, and notes ignored layers", async () => {
    const result = await run({
      [`${HOME}/.claude/settings.json`]: JSON.stringify({
        outputStyle: "Explanatory",
        pluginConfigs: { "agents-md@builtin": { options: { instructionFiles: "claude-md" } } },
      }),
      [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
        outputStyle: "Concise",
        permissions: { defaultMode: "bypassPermissions" },
        pluginConfigs: { "agents-md@builtin": { options: { instructionFiles: "managed-only" } } },
      }),
      [`${FOLDER}/.claude/settings.local.json`]: JSON.stringify({ permissions: { defaultMode: "plan" } }),
    });
    expect(result.effective.outputStyle).toMatchObject({
      value: "Concise",
      source: { path: `${FOLDER}/.claude/settings.json`, layer: "project" },
    });
    expect(result.effective.permissionMode.value).toBe("plan");
    expect(result.effective.instructionFiles.value).toBe("claude-md");
    expect(result.effective.instructionFiles.note).toContain("project settings can't set it");
  });

  it("ignores bypassPermissions from project settings and honours disableBypassPermissionsMode", async () => {
    const project = await run({
      [`${FOLDER}/.claude/settings.json`]: JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }),
    });
    expect(project.effective.permissionMode.value).toBe("default");
    expect(project.effective.permissionMode.note).toContain("bypassPermissions");

    const locked = await run({
      [`${HOME}/.claude/settings.json`]: JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }),
      [MANAGED]: JSON.stringify({ permissions: { disableBypassPermissionsMode: "disable" } }),
    });
    expect(locked.effective.permissionMode.value).toBe("default");
    expect(locked.effective.permissionMode.note).toContain("disableBypassPermissionsMode");
  });

  it("falls back to CLAUDE.md only when the agents-md plugin is disabled", async () => {
    const result = await run({
      [`${HOME}/.claude/settings.json`]: JSON.stringify({ enabledPlugins: { "agents-md@builtin": false } }),
    });
    expect(result.effective.instructionFiles.value).toBe("claude-md");
  });

  it("reads managed-settings.d drop-ins after managed-settings.json, later file winning", async () => {
    const result = await run({
      [MANAGED]: JSON.stringify({ outputStyle: "A" }),
      ["/etc/claude-code/managed-settings.d/10-a.json"]: JSON.stringify({ outputStyle: "B" }),
      ["/etc/claude-code/managed-settings.d/20-b.json"]: JSON.stringify({ outputStyle: "C" }),
      ["/etc/claude-code/managed-settings.d/.hidden.json"]: JSON.stringify({ outputStyle: "D" }),
      ["/etc/claude-code/managed-settings.d/notes.txt"]: "x",
    });
    expect(result.settings.filter((s) => s.layer === "managed").map((s) => s.path)).toEqual([
      MANAGED,
      "/etc/claude-code/managed-settings.d/10-a.json",
      "/etc/claude-code/managed-settings.d/20-b.json",
    ]);
    expect(result.effective.outputStyle.value).toBe("C");
  });

  it("turns workflows off when any file disables them, else follows enableWorkflows", async () => {
    const off = await run({
      [`${HOME}/.claude/settings.json`]: JSON.stringify({ enableWorkflows: true }),
      [`${FOLDER}/.claude/settings.json`]: JSON.stringify({ disableWorkflows: true }),
    });
    expect(off.effective.workflows).toMatchObject({ value: false, key: "disableWorkflows" });
    const user = await run({
      [`${HOME}/.claude/settings.json`]: JSON.stringify({ enableWorkflows: false }),
    });
    expect(user.effective.workflows).toMatchObject({ value: false, key: "enableWorkflows" });
    expect((await run({})).effective.workflows.value).toBe(true);
  });
});
