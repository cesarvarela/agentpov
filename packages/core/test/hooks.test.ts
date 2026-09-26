import { describe, expect, it } from "vitest";

import { type ResolveRun } from "../src/context.js";
import { collectEffective } from "../src/effective.js";
import { collectHooks, frontmatterHooks } from "../src/hooks.js";
import { resolveContext, type HookEntry, type ResolvedContext } from "../src/index.js";
import { pathFor } from "../src/paths.js";
import { memfs } from "./memfs.js";

const HOME = "/home/dev";
const FOLDER = "/projects/acme/shop-api";
const PLUGINS = `${HOME}/.claude/plugins`;
const MANAGED = "/etc/claude-code/managed-settings.json";
const USER_SETTINGS = `${HOME}/.claude/settings.json`;
const PROJECT_SETTINGS = `${FOLDER}/.claude/settings.json`;

function run(files: Record<string, string>): Promise<ResolvedContext> {
  return resolveContext(FOLDER, "src/app.ts", {
    fs: memfs(files),
    homeDir: HOME,
    platform: "linux",
  });
}

/** `installed_plugins.json` plus a cached copy for each `<name>@<marketplace>`. */
function plugin(
  id: string,
  files: Record<string, unknown>,
  manifest: Record<string, unknown> = {},
): Record<string, string> {
  const [name, marketplace] = id.split("@");
  const root = `${PLUGINS}/cache/${marketplace}/${name}/1.0.0`;
  const out: Record<string, string> = {
    [`${root}/.claude-plugin/plugin.json`]: JSON.stringify({ name, version: "1.0.0", ...manifest }),
  };
  for (const [path, content] of Object.entries(files)) {
    out[`${root}/${path}`] = typeof content === "string" ? content : JSON.stringify(content);
  }
  return out;
}

function installed(...ids: string[]): Record<string, string> {
  const plugins: Record<string, unknown> = {};
  for (const id of ids) {
    const [name, marketplace] = id.split("@");
    plugins[id] = [
      { scope: "user", installPath: `${PLUGINS}/cache/${marketplace}/${name}/1.0.0`, version: "1.0.0" },
    ];
  }
  return { [`${PLUGINS}/installed_plugins.json`]: JSON.stringify({ version: 2, plugins }) };
}

const rootOf = (id: string): string => {
  const [name, marketplace] = id.split("@");
  return `${PLUGINS}/cache/${marketplace}/${name}/1.0.0`;
};

const group = (matcher: string | undefined, ...hooks: Record<string, unknown>[]) =>
  matcher === undefined ? { hooks } : { matcher, hooks };

const settingsHooks = (command: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    ...extra,
    hooks: { PostToolUse: [group("Edit|Write", { type: "command", command })] },
  });

const byCommand = (hooks: HookEntry[], command: string): HookEntry | undefined =>
  hooks.find((hook) => hook.command === command);

describe("settings hook handlers", () => {
  it("reads http, prompt, agent and mcp_tool handlers and records the type", async () => {
    const { hooks } = await run({
      [PROJECT_SETTINGS]: JSON.stringify({
        hooks: {
          PreToolUse: [
            group(
              "Edit",
              { type: "http", url: "http://localhost:4012/hook", timeout: 5 },
              { type: "prompt", prompt: "Is this edit safe? $ARGUMENTS" },
              { type: "agent", prompt: "Verify the tests still pass" },
              { type: "mcp_tool", server: "scanner", tool: "scan" },
              { type: "command", command: "node", args: ["lint.js", "--fix"] },
              { type: "http" },
            ),
          ],
        },
      }),
    });

    expect(hooks.map((h) => [h.type, h.command, h.firesOnEdit])).toEqual([
      ["http", "http://localhost:4012/hook", true],
      ["prompt", "Is this edit safe? $ARGUMENTS", true],
      ["agent", "Verify the tests still pass", true],
      ["mcp_tool", "scan on scanner", true],
      ["command", "node lint.js --fix", true],
    ]);
    expect(hooks[0]).toMatchObject({ timeoutSeconds: 5, layer: "project", path: PROJECT_SETTINGS });
    expect(hooks[0]!.source).toBeUndefined();
  });

  it("reads a handler without a type as a command", async () => {
    const { hooks } = await run({
      [PROJECT_SETTINGS]: JSON.stringify({
        hooks: { Stop: [group(undefined, { command: "notify.sh" })] },
      }),
    });
    expect(hooks).toEqual([
      expect.objectContaining({ event: "Stop", command: "notify.sh", type: "command", firesOnEdit: false }),
    ]);
  });
});

describe("plugin hooks", () => {
  const ID = "fmt@official";

  it("loads hooks/hooks.json and every manifest hooks shape, expanding CLAUDE_PLUGIN_ROOT", async () => {
    const root = rootOf(ID);
    const { hooks } = await run({
      ...installed(ID),
      ...plugin(
        ID,
        {
          "hooks/hooks.json": {
            description: "Format on save",
            hooks: {
              PostToolUse: [
                group("Write|Edit", {
                  type: "command",
                  command: "node",
                  args: ["${CLAUDE_PLUGIN_ROOT}/format.js"],
                }),
              ],
            },
          },
          "config/extra.json": {
            hooks: { SessionStart: [group(undefined, { type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hi.sh" })] },
          },
        },
        {
          hooks: [
            "./config/extra.json",
            { Stop: [group(undefined, { type: "prompt", prompt: "done?" })] },
          ],
        },
      ),
    });

    expect(hooks.map((h) => [h.event, h.command, h.path])).toEqual([
      ["PostToolUse", `node ${root}/format.js`, `${root}/hooks/hooks.json`],
      ["SessionStart", `${root}/hi.sh`, `${root}/config/extra.json`],
      ["Stop", "done?", `${root}/.claude-plugin/plugin.json`],
    ]);
    for (const hook of hooks) {
      expect(hook).toMatchObject({ source: "plugin", plugin: "fmt", layer: "user" });
      expect(hook.disabled).toBeUndefined();
    }
    expect(hooks[0]!.firesOnEdit).toBe(true);
  });

  it("reads an inline manifest hooks object on its own", async () => {
    const { hooks } = await run({
      ...installed(ID),
      ...plugin(ID, {}, {
        hooks: { PreToolUse: [group("Bash", { type: "command", command: "audit.sh" })] },
      }),
    });
    expect(hooks).toEqual([
      expect.objectContaining({ event: "PreToolUse", matcher: "Bash", command: "audit.sh", plugin: "fmt" }),
    ]);
  });

  it("skips disabled plugins", async () => {
    const { hooks } = await run({
      ...installed(ID),
      ...plugin(ID, { "hooks/hooks.json": { hooks: { Stop: [group(undefined, { type: "command", command: "x" })] } } }),
      [USER_SETTINGS]: JSON.stringify({ enabledPlugins: { [ID]: false } }),
    });
    expect(hooks).toEqual([]);
  });

  it("takes the layer of a project skills-dir plugin", async () => {
    const root = `${FOLDER}/.claude/skills/guard`;
    const { hooks } = await run({
      [`${root}/.claude-plugin/plugin.json`]: JSON.stringify({ name: "guard" }),
      [`${root}/hooks/hooks.json`]: JSON.stringify({
        hooks: { PreToolUse: [group("Bash", { type: "command", command: "guard.sh" })] },
      }),
    });
    expect(hooks).toEqual([
      expect.objectContaining({ source: "plugin", plugin: "guard", layer: "project", path: `${root}/hooks/hooks.json` }),
    ]);
  });
});

describe("frontmatter hooks", () => {
  const skillMd = [
    "---",
    "name: secure-ops",
    "description: Use when: deploying (an unquoted colon)",
    "hooks:",
    "  PreToolUse:",
    '    - matcher: "Bash"',
    "      hooks:",
    "        - type: command",
    '          command: "./scripts/security-check.sh"',
    "          once: true",
    "  PostToolUse:",
    "  - matcher: Edit",
    "    hooks:",
    "    - {type: prompt, prompt: 'Review the edit'}",
    "allowed-tools: Bash",
    "---",
    "body",
  ].join("\n");

  it("parses the nested hooks block alone, ignoring other fields", () => {
    expect(frontmatterHooks(skillMd)).toEqual({
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "./scripts/security-check.sh", once: true }] },
      ],
      PostToolUse: [{ matcher: "Edit", hooks: [{ type: "prompt", prompt: "Review the edit" }] }],
    });
    expect(frontmatterHooks("---\nname: x\n---\n")).toBeUndefined();
    expect(frontmatterHooks("no frontmatter")).toBeUndefined();
  });

  it("registers skill hooks with the skill as owner, active once invoked", async () => {
    const path = `${FOLDER}/.claude/skills/secure-ops/SKILL.md`;
    const { hooks } = await run({ [path]: skillMd });

    expect(hooks.map((h) => [h.event, h.command, h.type])).toEqual([
      ["PreToolUse", "./scripts/security-check.sh", "command"],
      ["PostToolUse", "Review the edit", "prompt"],
    ]);
    expect(hooks[0]).toMatchObject({ source: "skill", owner: "secure-ops", layer: "project", path });
    expect(hooks[0]!.note).toContain("once: true");
    expect(hooks[1]!.note).toContain("rest of the session");
    expect(hooks[1]!.firesOnEdit).toBe(true);
  });

  it("registers subagent hooks, converting Stop to SubagentStop", async () => {
    const path = `${HOME}/.claude/agents/reviewer.md`;
    const { hooks } = await run({
      [path]: [
        "---",
        "name: reviewer",
        "description: Reviews code",
        "hooks:",
        "  Stop:",
        "    - hooks:",
        "        - type: command",
        "          command: summarize.sh",
        "  PreToolUse:",
        "    - matcher: Bash",
        "      hooks:",
        "        - type: command",
        "          command: ./validate.sh",
        "---",
        "You review code.",
      ].join("\n"),
    });

    expect(hooks.map((h) => [h.event, h.command])).toEqual([
      ["SubagentStop", "summarize.sh"],
      ["PreToolUse", "./validate.sh"],
    ]);
    expect(hooks[0]).toMatchObject({ source: "agent", owner: "reviewer", layer: "user", path });
    expect(hooks[0]!.note).toContain("declared as Stop");
    expect(hooks[1]!.note).toContain("only while the reviewer subagent runs");
  });

  it("ignores frontmatter hooks of plugin subagents", async () => {
    const agentMd = "---\nname: db\nhooks:\n  Stop:\n    - hooks:\n        - type: command\n          command: x.sh\n---\n";
    const pluginAgent = `${PLUGINS}/cache/official/db/1.0.0/agents/db.md`;
    const userAgent = `${HOME}/.claude/agents/db.md`;
    const run: ResolveRun = {
      fs: memfs({ [pluginAgent]: agentMd, [userAgent]: agentMd }),
      p: pathFor("linux"),
      platform: "linux",
      homeDir: HOME,
      folder: FOLDER,
      file: FOLDER,
      targetKind: "directory",
      managedDir: "/etc/claude-code",
      managedSettingsPath: MANAGED,
      gitRoot: null,
      repoRoot: FOLDER,
      diagnostics: [],
    };
    const hooks = await collectHooks(
      run,
      [],
      [],
      [],
      [
        { path: pluginAgent, layer: "user", name: "db:db", plugin: "db" },
        { path: userAgent, layer: "user", name: "db" },
      ],
      collectEffective([]),
    );
    expect(hooks.map((h) => [h.owner, h.path])).toEqual([["db", userAgent]]);
  });

  it("reports invalid YAML in the hooks block as a diagnostic", async () => {
    const path = `${FOLDER}/.claude/skills/broken/SKILL.md`;
    const result = await run({
      [path]: "---\nname: broken\nhooks:\n  PreToolUse: [unclosed\n---\n",
    });
    expect(result.hooks).toEqual([]);
    expect(result.diagnostics.some((d) => d.startsWith(`${path}: frontmatter hooks`))).toBe(true);
  });

  it("marks hooks of a shadowed skill as disabled", async () => {
    const hooksBlock = "hooks:\n  Stop:\n    - hooks:\n        - type: command\n          command: bye.sh\n";
    const { hooks } = await run({
      [`${HOME}/.claude/skills/deploy/SKILL.md`]: `---\nname: deploy\n${hooksBlock}---\n`,
      [`${FOLDER}/.claude/skills/deploy/SKILL.md`]: `---\nname: deploy\n${hooksBlock}---\n`,
    });
    const shadowed = hooks.filter((h) => h.disabled);
    expect(shadowed).toHaveLength(1);
    expect(shadowed[0]!.disabled).toContain("shadowed by");
  });
});

describe("hooks that don't run", () => {
  const ID = "vetted@corp";
  const OTHER = "random@community";
  const pluginHook = (command: string) => ({
    "hooks/hooks.json": { hooks: { Stop: [group(undefined, { type: "command", command })] } },
  });
  const agentFile = `${FOLDER}/.claude/agents/helper.md`;
  const skillFile = `${FOLDER}/.claude/skills/tidy/SKILL.md`;
  const base = (managed: Record<string, unknown>, user: Record<string, unknown> = {}) => ({
    [MANAGED]: settingsHooks("managed.sh", managed),
    [USER_SETTINGS]: settingsHooks("user.sh", user),
    [PROJECT_SETTINGS]: settingsHooks("project.sh"),
    ...installed(ID, OTHER),
    ...plugin(ID, pluginHook("vetted.sh")),
    ...plugin(OTHER, pluginHook("random.sh")),
    [agentFile]: "---\nname: helper\nhooks:\n  PreToolUse:\n    - hooks:\n        - type: command\n          command: agent.sh\n---\n",
    [skillFile]: "---\nname: tidy\nhooks:\n  PreToolUse:\n    - hooks:\n        - type: command\n          command: skill.sh\n---\n",
  });

  const disabledMap = (hooks: HookEntry[]) =>
    Object.fromEntries(hooks.map((h) => [h.command, h.disabled !== undefined]));

  it("runs everything by default", async () => {
    const { hooks } = await run(base({}));
    expect(disabledMap(hooks)).toEqual({
      "managed.sh": false,
      "user.sh": false,
      "project.sh": false,
      "vetted.sh": false,
      "random.sh": false,
      "skill.sh": false,
      "agent.sh": false,
    });
  });

  it("disableAllHooks outside managed settings keeps managed and force-enabled plugin hooks", async () => {
    const { hooks } = await run(
      base({ enabledPlugins: { [ID]: true } }, { disableAllHooks: true }),
    );
    expect(disabledMap(hooks)).toEqual({
      "managed.sh": false,
      "user.sh": true,
      "project.sh": true,
      "vetted.sh": false,
      "random.sh": true,
      "skill.sh": true,
      "agent.sh": true,
    });
    expect(byCommand(hooks, "user.sh")!.disabled).toBe(`disableAllHooks in ${USER_SETTINGS}`);
  });

  it("disableAllHooks in managed settings turns off every hook", async () => {
    const { hooks } = await run(base({ disableAllHooks: true, enabledPlugins: { [ID]: true } }));
    expect(Object.values(disabledMap(hooks)).every(Boolean)).toBe(true);
    expect(byCommand(hooks, "managed.sh")!.disabled).toContain("(managed) turns off every hook");
  });

  it("a project disableAllHooks: false beats a user true", async () => {
    const { hooks } = await run({
      ...base({}, { disableAllHooks: true }),
      [PROJECT_SETTINGS]: settingsHooks("project.sh", { disableAllHooks: false }),
    });
    expect(byCommand(hooks, "user.sh")!.disabled).toBeUndefined();
  });

  it("allowManagedHooksOnly runs only managed and force-enabled plugin hooks", async () => {
    const { hooks } = await run(
      base({ allowManagedHooksOnly: true, enabledPlugins: { [ID]: true } }),
    );
    expect(disabledMap(hooks)).toEqual({
      "managed.sh": false,
      "user.sh": true,
      "project.sh": true,
      "vetted.sh": false,
      "random.sh": true,
      "skill.sh": true,
      "agent.sh": true,
    });
    expect(byCommand(hooks, "agent.sh")!.disabled).toContain("subagent frontmatter");
    expect(byCommand(hooks, "random.sh")!.disabled).toContain(`allowManagedHooksOnly in ${MANAGED}`);
  });

  it("ignores allowManagedHooksOnly outside managed settings", async () => {
    const { hooks } = await run(base({}, { allowManagedHooksOnly: true }));
    expect(hooks.every((h) => h.disabled === undefined)).toBe(true);
  });

  it("a force-enable matches the full plugin id only", async () => {
    const { hooks } = await run(
      base({ allowManagedHooksOnly: true, enabledPlugins: { "vetted@elsewhere": true } }),
    );
    expect(byCommand(hooks, "vetted.sh")!.disabled).toBeDefined();
  });

  it("strictPluginOnlyCustomization hooks stops user, project and local settings hooks", async () => {
    const { hooks } = await run(base({ strictPluginOnlyCustomization: ["hooks"] }));
    expect(disabledMap(hooks)).toEqual({
      "managed.sh": false,
      "user.sh": true,
      "project.sh": true,
      "vetted.sh": false,
      "random.sh": false,
      "skill.sh": false,
      "agent.sh": false,
    });
    expect(byCommand(hooks, "project.sh")!.disabled).toContain(
      `strictPluginOnlyCustomization locks hooks in ${MANAGED}`,
    );

    const other = await run(base({ strictPluginOnlyCustomization: ["skills"] }));
    expect(byCommand(other.hooks, "project.sh")!.disabled).toBeUndefined();
  });

  it("drops frontmatter hooks with their skill or subagent when those surfaces are locked too", async () => {
    const { hooks } = await run(base({ strictPluginOnlyCustomization: true }));
    expect(byCommand(hooks, "user.sh")!.disabled).toContain("strictPluginOnlyCustomization");
    expect(byCommand(hooks, "skill.sh")!.disabled).toContain("the skill tidy doesn't load");
    expect(byCommand(hooks, "agent.sh")!.disabled).toContain("the subagent helper doesn't load");
    expect(byCommand(hooks, "random.sh")!.disabled).toBeUndefined();
  });
});
