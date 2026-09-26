import { describe, expect, it } from "vitest";

import { resolveContext, type McpServerEntry, type ResolvedContext } from "../src/index.js";
import { mcpUrlMatches } from "../src/mcp.js";
import { memfs } from "./memfs.js";

const HOME = "/home/dev";
const FOLDER = "/projects/acme/shop-api";
const PLUGINS = `${HOME}/.claude/plugins`;
const MANAGED = "/etc/claude-code/managed-settings.json";
const MANAGED_MCP = "/etc/claude-code/managed-mcp.json";
const USER_SETTINGS = `${HOME}/.claude/settings.json`;
const PROJECT_SETTINGS = `${FOLDER}/.claude/settings.json`;
const LOCAL_SETTINGS = `${FOLDER}/.claude/settings.local.json`;
const CLAUDE_JSON = `${HOME}/.claude.json`;
const MCP_JSON = `${FOLDER}/.mcp.json`;

function run(files: Record<string, string>): Promise<ResolvedContext> {
  return resolveContext(FOLDER, FOLDER, {
    fs: memfs(files),
    homeDir: HOME,
    platform: "linux",
    targetKind: "directory",
  });
}

const json = (value: unknown): string => JSON.stringify(value);

function marketplacePlugin(
  id: string,
  files: Record<string, unknown>,
  manifest: Record<string, unknown> = {},
): Record<string, string> {
  const [name, marketplace] = id.split("@");
  const root = `${PLUGINS}/cache/${marketplace}/${name}/1.0.0`;
  const out: Record<string, string> = {
    [`${PLUGINS}/installed_plugins.json`]: json({
      version: 2,
      plugins: { [id]: [{ scope: "user", installPath: root, version: "1.0.0" }] },
    }),
    [`${root}/.claude-plugin/plugin.json`]: json({ name, version: "1.0.0", ...manifest }),
  };
  for (const [path, content] of Object.entries(files)) out[`${root}/${path}`] = json(content);
  return out;
}

const byName = (servers: McpServerEntry[]): Map<string, McpServerEntry> =>
  new Map(servers.map((server) => [server.name, server]));

/** A user server, a local server and a `.mcp.json` server, all approved. */
const everyScope = {
  [CLAUDE_JSON]: json({
    mcpServers: { memory: { command: "mcp-memory", args: ["--fast"] } },
    projects: { [FOLDER]: { mcpServers: { scratch: { type: "http", url: "https://scratch.example.com/mcp" } } } },
  }),
  [MCP_JSON]: json({ mcpServers: { github: { type: "http", url: "https://api.githubcopilot.com/mcp/" } } }),
  [LOCAL_SETTINGS]: json({ enableAllProjectMcpServers: true }),
};

describe("plugin MCP servers", () => {
  const ID = "db-tools@official";
  const root = `${PLUGINS}/cache/official/db-tools/1.0.0`;

  it("merges .mcp.json with every manifest shape, later names winning, and expands CLAUDE_PLUGIN_ROOT", async () => {
    const { mcpServers } = await run(
      marketplacePlugin(
        ID,
        {
          ".mcp.json": {
            mcpServers: {
              db: { command: "${CLAUDE_PLUGIN_ROOT}/bin/db", args: ["--config", "${CLAUDE_PLUGIN_ROOT}/c.json"] },
              api: { command: "old-api" },
            },
          },
          "mcp/extra.json": { search: { type: "http", url: "https://search.example.com/${CLAUDE_PLUGIN_ROOT}" } },
        },
        {
          mcpServers: [
            "./mcp/extra.json",
            { api: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/api.js"], env: { ROOT: "${CLAUDE_PLUGIN_ROOT}" } } },
            "./bundle.mcpb",
          ],
        },
      ),
    );

    const servers = byName(mcpServers);
    expect([...servers.keys()]).toEqual([
      "plugin:db-tools:api",
      "plugin:db-tools:db",
      "plugin:db-tools:search",
    ]);
    expect(servers.get("plugin:db-tools:db")).toMatchObject({
      plugin: "db-tools",
      layer: "user",
      state: "enabled",
      transport: "stdio",
      target: `${root}/bin/db --config ${root}/c.json`,
      path: `${root}/.mcp.json`,
    });
    expect(servers.get("plugin:db-tools:api")).toMatchObject({
      target: `node ${root}/api.js`,
      env: { ROOT: root },
      path: `${root}/.claude-plugin/plugin.json`,
    });
    expect(servers.get("plugin:db-tools:search")).toMatchObject({
      transport: "http",
      target: `https://search.example.com/${root}`,
      path: `${root}/mcp/extra.json`,
    });
    expect(servers.get("plugin:db-tools:db")!.reason).toContain("need no approval");
  });

  it("puts a project skills-dir plugin's servers through .mcp.json approval", async () => {
    const pluginRoot = `${FOLDER}/.claude/skills/guard`;
    const files = {
      [`${pluginRoot}/.claude-plugin/plugin.json`]: json({ name: "guard" }),
      [`${pluginRoot}/.mcp.json`]: json({ scanner: { command: "scan" }, other: { command: "o" } }),
    };

    const pending = await run(files);
    expect(pending.mcpServers.map((s) => [s.name, s.layer, s.state])).toEqual([
      ["plugin:guard:other", "project", "unapproved"],
      ["plugin:guard:scanner", "project", "unapproved"],
    ]);

    const decided = byName(
      (
        await run({
          ...files,
          [LOCAL_SETTINGS]: json({
            enabledMcpjsonServers: ["plugin:guard:scanner"],
            disabledMcpjsonServers: ["other"],
          }),
        })
      ).mcpServers,
    );
    expect(decided.get("plugin:guard:scanner")).toMatchObject({
      state: "enabled",
      stateKey: "enabledMcpjsonServers",
    });
    expect(decided.get("plugin:guard:other")).toMatchObject({
      state: "disabled",
      stateKey: "disabledMcpjsonServers",
    });
  });

  it("skips a project plugin's server file outside its directory", async () => {
    const pluginRoot = `${FOLDER}/.claude/skills/guard`;
    const result = await run({
      [`${pluginRoot}/.claude-plugin/plugin.json`]: json({ name: "guard", mcpServers: "../shared.json" }),
      [`${FOLDER}/.claude/skills/shared.json`]: json({ leak: { command: "x" } }),
    });
    expect(result.mcpServers).toEqual([]);
    expect(result.diagnostics.some((d) => d.includes("outside the plugin directory"))).toBe(true);
  });

  it("ignores disabled plugins", async () => {
    const { mcpServers } = await run({
      ...marketplacePlugin(ID, { ".mcp.json": { mcpServers: { db: { command: "db" } } } }),
      [USER_SETTINGS]: json({ enabledPlugins: { [ID]: false } }),
    });
    expect(mcpServers).toEqual([]);
  });
});

describe("managed-mcp.json", () => {
  it("takes exclusive control: its servers load, every other server is blocked", async () => {
    const { mcpServers } = await run({
      ...everyScope,
      ...marketplacePlugin("db-tools@official", { ".mcp.json": { db: { command: "db" } } }),
      [MANAGED_MCP]: json({ mcpServers: { corp: { type: "http", url: "https://mcp.corp.example/" } } }),
    });

    const servers = byName(mcpServers);
    expect(servers.get("corp")).toMatchObject({
      layer: "managed",
      path: MANAGED_MCP,
      state: "enabled",
    });
    for (const name of ["memory", "scratch", "github", "plugin:db-tools:db"]) {
      expect(servers.get(name)).toMatchObject({ state: "blocked", stateSource: MANAGED_MCP });
      expect(servers.get(name)!.reason).toContain("managed-mcp.json");
    }
  });

  it("still takes exclusive control when it can't be parsed", async () => {
    const result = await run({ ...everyScope, [MANAGED_MCP]: "{ not json" });
    expect(result.mcpServers.every((s) => s.state === "blocked")).toBe(true);
    expect(result.diagnostics).toContain(`${MANAGED_MCP}: invalid JSON`);
  });

  it("loads managedMcpServers alongside it, the file winning a shared name", async () => {
    const { mcpServers } = await run({
      [MANAGED_MCP]: json({ mcpServers: { search: { type: "http", url: "https://a.example.com/mcp" } } }),
      [MANAGED]: json({
        managedMcpServers: {
          search: { type: "http", url: "https://b.example.com/mcp" },
          docs: { type: "sse", url: "https://docs.example.com/sse" },
        },
      }),
    });
    expect(mcpServers.map((s) => [s.name, s.path, s.state])).toEqual([
      ["search", MANAGED_MCP, "enabled"],
      ["docs", MANAGED, "enabled"],
      ["search", MANAGED, "blocked"],
    ]);
  });
});

describe("managedMcpServers", () => {
  it("provides valid entries, drops invalid ones, and ignores the key outside managed settings", async () => {
    const result = await run({
      [MANAGED]: json({
        managedMcpServers: {
          search: { type: "http", url: "https://search.example.com/mcp" },
          plain: { type: "http", url: "http://insecure.example.com" },
          local: { type: "http", url: "https://x.example.com", command: "evil" },
          templated: { type: "http", url: "https://${HOST}/mcp" },
        },
      }),
      [USER_SETTINGS]: json({ managedMcpServers: { mine: { type: "http", url: "https://m.example.com" } } }),
    });
    expect(result.mcpServers).toEqual([
      expect.objectContaining({
        name: "search",
        layer: "managed",
        path: MANAGED,
        state: "enabled",
        stateKey: "managedMcpServers",
      }),
    ]);
    const joined = result.diagnostics.join("\n");
    expect(joined).toContain("managedMcpServers.plain is dropped");
    expect(joined).toContain("managedMcpServers.local is dropped");
    expect(joined).toContain("managedMcpServers.templated is dropped");
    expect(joined).toContain(`${USER_SETTINGS}: managedMcpServers is only read from managed settings`);
  });

  it("outranks a same-named user server and a plugin server at the same URL", async () => {
    const { mcpServers } = await run({
      [MANAGED]: json({
        managedMcpServers: { memory: { type: "http", url: "https://Memory.example.com:443/mcp/" } },
      }),
      ...everyScope,
      ...marketplacePlugin("mem@official", {
        ".mcp.json": { remote: { type: "http", url: "https://memory.example.com/mcp" } },
      }),
    });
    const user = mcpServers.find((s) => s.name === "memory" && s.layer === "user")!;
    expect(user).toMatchObject({ state: "blocked", stateKey: "managedMcpServers", stateSource: MANAGED });
    const plugin = mcpServers.find((s) => s.name === "plugin:mem:remote")!;
    expect(plugin.state).toBe("blocked");
    expect(plugin.reason).toContain("at the same URL");
  });
});

describe("allowedMcpServers and deniedMcpServers", () => {
  const states = (servers: McpServerEntry[]) =>
    Object.fromEntries(servers.map((s) => [s.name, s.state]));

  it("blocks a denied server wherever it comes from, naming the file", async () => {
    const { mcpServers } = await run({
      ...everyScope,
      [PROJECT_SETTINGS]: json({
        deniedMcpServers: [{ serverName: "memory" }, { serverUrl: "https://*.githubcopilot.com/*" }],
      }),
    });
    const servers = byName(mcpServers);
    expect(servers.get("memory")).toMatchObject({
      state: "blocked",
      stateSource: PROJECT_SETTINGS,
      stateKey: "deniedMcpServers",
    });
    expect(servers.get("memory")!.reason).toBe(
      `blocked by deniedMcpServers (serverName memory) in ${PROJECT_SETTINGS}`,
    );
    expect(servers.get("github")!.state).toBe("blocked");
    expect(servers.get("scratch")!.state).toBe("enabled");
  });

  it("lets the denylist win over the allowlist", async () => {
    const { mcpServers } = await run({
      ...everyScope,
      [USER_SETTINGS]: json({
        allowedMcpServers: [{ serverName: "memory" }],
        deniedMcpServers: [{ serverCommand: ["mcp-memory", "--fast"] }],
      }),
    });
    expect(byName(mcpServers).get("memory")).toMatchObject({
      state: "blocked",
      stateKey: "deniedMcpServers",
    });
  });

  it("treats an empty allowlist as allowing none", async () => {
    const { mcpServers } = await run({ ...everyScope, [USER_SETTINGS]: json({ allowedMcpServers: [] }) });
    expect(states(mcpServers)).toEqual({ memory: "blocked", scratch: "blocked", github: "blocked" });
    expect(mcpServers[0]!.reason).toContain("allows none");
  });

  it("requires a serverUrl match for remote servers once the list has one", async () => {
    const { mcpServers } = await run({
      ...everyScope,
      [USER_SETTINGS]: json({
        allowedMcpServers: [
          { serverUrl: "https://api.githubcopilot.com/*" },
          { serverName: "scratch" },
          { serverName: "memory" },
        ],
      }),
    });
    // github matches the URL; scratch is remote and only name-listed; memory
    // is stdio and there are no serverCommand entries, so its name counts.
    expect(states(mcpServers)).toEqual({ memory: "enabled", scratch: "blocked", github: "enabled" });
    expect(byName(mcpServers).get("scratch")!.reason).toContain("must match a serverUrl entry");
  });

  it("requires an exact serverCommand match for stdio servers once the list has one", async () => {
    const { mcpServers } = await run({
      ...everyScope,
      [USER_SETTINGS]: json({
        allowedMcpServers: [{ serverCommand: ["mcp-memory"] }, { serverName: "github" }, { serverName: "scratch" }],
      }),
    });
    expect(states(mcpServers)).toEqual({ memory: "blocked", scratch: "enabled", github: "enabled" });
  });

  it("merges allowlists from every file", async () => {
    const { mcpServers } = await run({
      ...everyScope,
      [MANAGED]: json({ allowedMcpServers: [{ serverName: "github" }] }),
      [USER_SETTINGS]: json({ allowedMcpServers: [{ serverName: "memory" }] }),
    });
    expect(states(mcpServers)).toEqual({ memory: "enabled", scratch: "blocked", github: "enabled" });
    expect(byName(mcpServers).get("scratch")!.reason).toContain(`${MANAGED}, ${USER_SETTINGS}`);
  });

  it("keeps only the managed allowlist under allowManagedMcpServersOnly", async () => {
    const { mcpServers } = await run({
      ...everyScope,
      [MANAGED]: json({ allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverName: "github" }] }),
      [USER_SETTINGS]: json({ allowedMcpServers: [{ serverName: "memory" }] }),
    });
    expect(states(mcpServers)).toEqual({ memory: "blocked", scratch: "blocked", github: "enabled" });
    expect(byName(mcpServers).get("memory")!.reason).toContain("allowManagedMcpServersOnly");
  });

  it("applies to plugin servers by scoped or bare name", async () => {
    const { mcpServers } = await run({
      ...marketplacePlugin("db-tools@official", {
        ".mcp.json": { db: { command: "db" }, cache: { command: "cache" } },
      }),
      [USER_SETTINGS]: json({
        allowedMcpServers: [{ serverName: "plugin:db-tools:db" }, { serverName: "cache" }],
        deniedMcpServers: [{ serverName: "cache" }],
      }),
    });
    expect(states(mcpServers)).toEqual({
      "plugin:db-tools:cache": "blocked",
      "plugin:db-tools:db": "enabled",
    });
  });

  it("exempts the organization's own servers from the allowlist but not the denylist", async () => {
    const { mcpServers } = await run({
      [MANAGED_MCP]: json({
        mcpServers: {
          fixed: { command: "/usr/local/bin/corp" },
          templated: { command: "${HOME}/bin/corp" },
          denied: { type: "http", url: "https://bad.example.com" },
        },
      }),
      [MANAGED]: json({
        allowedMcpServers: [{ serverName: "nothing" }],
        deniedMcpServers: [{ serverUrl: "https://bad.example.com" }],
        managedMcpServers: { provided: { type: "http", url: "https://p.example.com" } },
      }),
    });
    expect(states(mcpServers)).toEqual({
      denied: "blocked",
      fixed: "enabled",
      templated: "blocked",
      provided: "enabled",
    });
  });
});

describe("strictPluginOnlyCustomization mcp", () => {
  it("blocks ~/.claude.json and .mcp.json servers but keeps plugin and managed ones", async () => {
    const { mcpServers } = await run({
      ...everyScope,
      ...marketplacePlugin("db-tools@official", { ".mcp.json": { db: { command: "db" } } }),
      [MANAGED]: json({
        strictPluginOnlyCustomization: ["mcp"],
        managedMcpServers: { provided: { type: "http", url: "https://p.example.com" } },
      }),
    });
    const servers = byName(mcpServers);
    for (const name of ["memory", "scratch", "github"]) {
      expect(servers.get(name)).toMatchObject({
        state: "blocked",
        stateKey: "strictPluginOnlyCustomization",
        stateSource: MANAGED,
      });
    }
    expect(servers.get("plugin:db-tools:db")!.state).toBe("enabled");
    expect(servers.get("provided")!.state).toBe("enabled");
  });

  it("leaves MCP alone when only other surfaces are locked", async () => {
    const { mcpServers } = await run({
      ...everyScope,
      [MANAGED]: json({ strictPluginOnlyCustomization: ["skills", "hooks"] }),
    });
    expect(mcpServers.every((s) => s.state === "enabled")).toBe(true);
  });
});

describe(".mcp.json approval precedence", () => {
  it("lets a higher-precedence enableAllProjectMcpServers: false override a lower true", async () => {
    const { mcpServers } = await run({
      [MCP_JSON]: json({ mcpServers: { github: { type: "http", url: "https://g.example.com" } } }),
      [USER_SETTINGS]: json({ enableAllProjectMcpServers: true }),
      [LOCAL_SETTINGS]: json({ enableAllProjectMcpServers: false }),
    });
    expect(mcpServers[0]!.state).toBe("unapproved");
    expect(mcpServers[0]!.reason).toContain(`enableAllProjectMcpServers is false in ${LOCAL_SETTINGS}`);
  });

  it("reports managed settings as the most specific file", async () => {
    const { mcpServers } = await run({
      [MCP_JSON]: json({ mcpServers: { github: { type: "http", url: "https://g.example.com" } } }),
      [MANAGED]: json({ enabledMcpjsonServers: ["github"] }),
      [LOCAL_SETTINGS]: json({ enabledMcpjsonServers: ["github"] }),
    });
    expect(mcpServers[0]).toMatchObject({ state: "enabled", stateSource: MANAGED });
  });
});

describe("the /mcp toggle", () => {
  it("disables user, local and plugin servers listed in the project's disabledMcpServers", async () => {
    const { mcpServers } = await run({
      [CLAUDE_JSON]: json({
        mcpServers: { memory: { command: "mcp-memory" } },
        projects: {
          [FOLDER]: {
            mcpServers: { scratch: { type: "http", url: "https://s.example.com" } },
            disabledMcpServers: ["memory", "plugin:db-tools:db", "github"],
          },
        },
      }),
      [MCP_JSON]: json({ mcpServers: { github: { type: "http", url: "https://g.example.com" } } }),
      [LOCAL_SETTINGS]: json({ enableAllProjectMcpServers: true }),
      ...marketplacePlugin("db-tools@official", { ".mcp.json": { db: { command: "db" } } }),
    });
    const servers = byName(mcpServers);
    expect(servers.get("memory")).toMatchObject({ state: "disabled", stateKey: "disabledMcpServers" });
    expect(servers.get("plugin:db-tools:db")!.state).toBe("disabled");
    expect(servers.get("scratch")!.state).toBe("enabled");
    // `.mcp.json` servers use disabledMcpjsonServers, not this list.
    expect(servers.get("github")!.state).toBe("enabled");
  });
});

describe("mcpUrlMatches", () => {
  it.each([
    ["https://mcp.example.com/*", "https://mcp.example.com/api", true],
    ["https://mcp.example.com", "https://mcp.example.com/any/path", true],
    ["https://*.example.com/*", "https://api.example.com/mcp", true],
    ["https://*.example.com/*", "https://example.org/mcp", false],
    ["http://localhost:*/*", "http://localhost:4011/mcp", true],
    ["*://mcp.example.com/*", "http://mcp.example.com/x", true],
    ["https://Mcp.Example.com/*", "https://mcp.example.com./api", true],
    ["https://mcp.example.com/API/*", "https://mcp.example.com/api/x", false],
    ["https://mcp.example.com/*", "https://mcp.example.com", true],
  ])("%s vs %s → %s", (pattern, url, expected) => {
    expect(mcpUrlMatches(pattern, url)).toBe(expected);
  });
});
