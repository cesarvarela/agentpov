import { describe, expect, it } from "vitest";

import { locateRepository, type ResolveRun } from "../src/context.js";
import { collectAgents, collectSkills } from "../src/discovery.js";
import { pathFor } from "../src/paths.js";
import { collectPlugins } from "../src/plugins.js";
import { collectSettings } from "../src/settings.js";
import { memfs } from "./memfs.js";

const HOME = "/home/dev";
const FOLDER = "/projects/acme/shop-api";
const MANAGED = "/etc/claude-code";
const PLUGIN = "/opt/plugins/acme";

/** Runs the settings → plugins → skills/agents part of `resolveContext`. */
async function discover(files: Record<string, string>, folder = FOLDER) {
  const fs = memfs(files);
  const p = pathFor("linux");
  const repository = await locateRepository(fs, p, folder);
  const run: ResolveRun = {
    fs,
    p,
    platform: "linux",
    homeDir: HOME,
    folder,
    file: `${folder}/src/index.ts`,
    targetKind: "file",
    managedDir: MANAGED,
    managedSettingsPath: `${MANAGED}/managed-settings.json`,
    gitRoot: repository.gitRoot,
    repoRoot: repository.repoRoot,
    diagnostics: [],
  };
  const settings = await collectSettings(run);
  const plugins = await collectPlugins(run, settings);
  return {
    skills: await collectSkills(run, plugins, settings),
    agents: await collectAgents(run, plugins, settings),
  };
}

/** Installs the `acme` plugin from `/opt/plugins/acme`, with an optional manifest. */
function acme(manifest: Record<string, unknown> = {}): Record<string, string> {
  return {
    [`${HOME}/.claude/plugins/installed_plugins.json`]: JSON.stringify({
      version: 2,
      plugins: { "acme@corp": [{ scope: "user", installPath: PLUGIN }] },
    }),
    [`${PLUGIN}/.claude-plugin/plugin.json`]: JSON.stringify({ name: "acme", ...manifest }),
  };
}

const managedSettings = (values: Record<string, unknown>): Record<string, string> => ({
  [`${MANAGED}/managed-settings.json`]: JSON.stringify(values),
});

const agentFile = (name: string, extra = ""): string =>
  `---\nname: ${name}\ndescription: ${name} agent\n${extra}---\nBody.\n`;

describe("managed skills and subagents", () => {
  it("loads enterprise skills from the managed directory and lets them win", async () => {
    const managedPath = `${MANAGED}/.claude/skills/deploy/SKILL.md`;
    const { skills } = await discover({
      [managedPath]: "---\nname: deploy\ndescription: enterprise\n---\n",
      [`${HOME}/.claude/skills/deploy/SKILL.md`]: "---\nname: deploy\n---\n",
      [`${FOLDER}/.claude/skills/deploy/SKILL.md`]: "---\nname: deploy\n---\n",
    });

    expect(skills.map((s) => [s.source, s.layer, s.shadowedBy?.layer])).toEqual([
      ["managed", "managed", undefined],
      ["personal", "user", "managed"],
      ["project", "project", "managed"],
    ]);
    expect(skills[1]!.shadowedBy?.path).toBe(managedPath);
  });

  it("skips a skill folder named synced in any capitalization outside ~/.claude/skills/synced", async () => {
    const { skills } = await discover({
      [`${MANAGED}/.claude/skills/Synced/SKILL.md`]: "---\nname: x\n---\n",
      [`${FOLDER}/.claude/skills/SYNCED/SKILL.md`]: "---\nname: y\n---\n",
      [`${FOLDER}/.claude/skills/ok/SKILL.md`]: "---\nname: ok\n---\n",
    });
    expect(skills.map((s) => s.name)).toEqual(["ok"]);
  });

  it("loads managed subagents, which outrank project and user ones", async () => {
    const managedPath = `${MANAGED}/.claude/agents/reviewer.md`;
    const { agents } = await discover({
      [managedPath]: agentFile("reviewer"),
      [`${HOME}/.claude/agents/reviewer.md`]: agentFile("reviewer"),
      [`${FOLDER}/.claude/agents/reviewer.md`]: agentFile("reviewer"),
    });

    expect(agents.map((a) => [a.layer, a.shadowedBy?.layer])).toEqual([
      ["managed", undefined],
      ["user", "managed"],
      ["project", "managed"],
    ]);
  });

  it("scans agent folders recursively without adding subfolders to the name", async () => {
    const { agents } = await discover({
      [`${HOME}/.claude/agents/review/security.md`]: agentFile("security"),
      [`${FOLDER}/.claude/agents/research/deep/scout.md`]: agentFile("scout"),
    });
    expect(agents.map((a) => [a.name, a.layer])).toEqual([
      ["security", "user"],
      ["scout", "project"],
    ]);
  });

  it("prefers the project subagent closest to the folder", async () => {
    const folder = "/repo/apps/web";
    const closest = `${folder}/.claude/agents/reviewer.md`;
    const { agents } = await discover(
      {
        "/repo/.git/HEAD": "ref: refs/heads/main",
        "/repo/.claude/agents/reviewer.md": agentFile("reviewer"),
        [closest]: agentFile("reviewer"),
      },
      folder,
    );
    expect(agents.map((a) => [a.path, a.shadowedBy?.path])).toEqual([
      [closest, undefined],
      ["/repo/.claude/agents/reviewer.md", closest],
    ]);
  });
});

describe("plugin subagents", () => {
  it("names agents <plugin>:<subfolders>:<name> from the default agents/ scan", async () => {
    const { agents } = await discover({
      ...acme(),
      [`${PLUGIN}/agents/helper.md`]: agentFile("helper"),
      [`${PLUGIN}/agents/review/security.md`]: "no frontmatter",
      [`${PLUGIN}/agents/review/audit-file.md`]: agentFile("audit"),
    });

    expect(agents.map((a) => [a.name, a.plugin, a.layer])).toEqual([
      ["acme:helper", "acme", "user"],
      // Frontmatter `name` replaces only the file name.
      ["acme:review:audit", "acme", "user"],
      // No frontmatter: a plugin agent still loads under its file name.
      ["acme:review:security", "acme", "user"],
    ]);
  });

  it("loads only the files the manifest lists, without subfolder names", async () => {
    const { agents } = await discover({
      ...acme({ agents: ["./custom/review/security.md"] }),
      [`${PLUGIN}/custom/review/security.md`]: agentFile("security"),
      [`${PLUGIN}/agents/ignored.md`]: agentFile("ignored"),
    });
    expect(agents.map((a) => a.name)).toEqual(["acme:security"]);
  });

  it("drops permissionMode and mcpServers, which plugin agents ignore", async () => {
    const { agents } = await discover({
      ...acme(),
      [`${PLUGIN}/agents/runner.md`]: agentFile(
        "runner",
        "permissionMode: bypassPermissions\nmcpServers: [github]\nmodel: sonnet\n",
      ),
    });
    expect(agents[0]).toEqual({
      path: `${PLUGIN}/agents/runner.md`,
      layer: "user",
      name: "acme:runner",
      description: "runner agent",
      model: "sonnet",
      plugin: "acme",
    });
  });

  it("never shadows or is shadowed by a local subagent", async () => {
    const { agents } = await discover({
      ...acme(),
      [`${PLUGIN}/agents/reviewer.md`]: agentFile("reviewer"),
      [`${HOME}/.claude/agents/reviewer.md`]: agentFile("reviewer"),
    });
    expect(agents.map((a) => [a.name, a.shadowedBy])).toEqual([
      ["reviewer", undefined],
      ["acme:reviewer", undefined],
    ]);
  });

  it("contributes nothing while the plugin is disabled", async () => {
    const { agents } = await discover({
      ...acme(),
      [`${PLUGIN}/agents/helper.md`]: agentFile("helper"),
      [`${HOME}/.claude/settings.json`]: JSON.stringify({ enabledPlugins: { "acme@corp": false } }),
    });
    expect(agents).toEqual([]);
  });
});

describe("plugin commands", () => {
  it("namespaces commands/ files, adding a segment per subfolder", async () => {
    const { skills } = await discover({
      ...acme(),
      [`${PLUGIN}/commands/about.md`]: "---\ndescription: About\nallowed-tools: Read\n---\n",
      [`${PLUGIN}/commands/db/migrate.md`]: "Migrate.",
    });

    expect(skills.map((s) => [s.name, s.shortName, s.source, s.plugin, s.layer])).toEqual([
      ["acme:about", "about", "command", "acme", "user"],
      ["acme:db:migrate", "db:migrate", "command", "acme", "user"],
    ]);
    expect(skills[0]).toMatchObject({ description: "About", allowedTools: ["Read"] });
  });

  it("replaces the default scan with the manifest paths (files or directories)", async () => {
    const { skills } = await discover({
      ...acme({ commands: ["./extra/one.md", "./more/"] }),
      [`${PLUGIN}/commands/ignored.md`]: "Ignored.",
      [`${PLUGIN}/extra/one.md`]: "One.",
      [`${PLUGIN}/more/two.md`]: "Two.",
      [`${PLUGIN}/more/sub/three.md`]: "Three.",
    });
    expect(skills.map((s) => s.name)).toEqual(["acme:one", "acme:sub:three", "acme:two"]);
  });

  it("reads the object-map form: source files and inline content", async () => {
    const { skills } = await discover({
      ...acme({
        commands: {
          status: { source: "./commands/status.md", argumentHint: "[env]" },
          about: { content: "Explain the plugin.", description: "Explain it" },
          broken: { source: "./commands/status.md", content: "both" },
        },
      }),
      [`${PLUGIN}/commands/status.md`]: "---\ndescription: Status\n---\n",
      [`${PLUGIN}/commands/unlisted.md`]: "Not loaded.",
    });

    expect(skills.map((s) => [s.name, s.path, s.description])).toEqual([
      ["acme:status", `${PLUGIN}/commands/status.md`, "Status"],
      ["acme:about", `${PLUGIN}/.claude-plugin/plugin.json`, "Explain it"],
    ]);
  });

  it("never shadows a project skill or command of the same short name", async () => {
    const { skills } = await discover({
      ...acme(),
      [`${PLUGIN}/commands/deploy.md`]: "Plugin deploy.",
      [`${FOLDER}/.claude/commands/deploy.md`]: "Project deploy.",
    });
    expect(skills.map((s) => [s.name, s.shadowedBy])).toEqual([
      ["acme:deploy", undefined],
      ["deploy", undefined],
    ]);
  });
});

describe("strictPluginOnlyCustomization", () => {
  const everything = {
    ...acme(),
    [`${PLUGIN}/skills/lint/SKILL.md`]: "---\nname: lint\n---\n",
    [`${PLUGIN}/agents/helper.md`]: agentFile("helper"),
    [`${MANAGED}/.claude/skills/policy/SKILL.md`]: "---\nname: policy\n---\n",
    [`${MANAGED}/.claude/agents/auditor.md`]: agentFile("auditor"),
    [`${HOME}/.claude/skills/tidy/SKILL.md`]: "---\nname: tidy\n---\n",
    [`${HOME}/.claude/skills/synced/b1/docs/SKILL.md`]: "---\nname: docs\n---\n",
    [`${HOME}/.claude/agents/mine.md`]: agentFile("mine"),
    [`${FOLDER}/.claude/skills/deploy/SKILL.md`]: "---\nname: deploy\n---\n",
    [`${FOLDER}/.claude/commands/ship.md`]: "Ship.",
    [`${FOLDER}/.claude/agents/ours.md`]: agentFile("ours"),
  };

  const disabledSkills = (skills: { name: string; disabled?: string }[]): string[] =>
    skills.filter((s) => s.disabled).map((s) => s.name);

  it("with true, keeps only plugin and managed skills and subagents", async () => {
    const path = `${MANAGED}/managed-settings.json`;
    const { skills, agents } = await discover({
      ...everything,
      ...managedSettings({ strictPluginOnlyCustomization: true }),
    });

    expect(disabledSkills(skills)).toEqual(["tidy", "anthropic-skills:docs", "deploy", "ship"]);
    expect(skills.find((s) => s.name === "tidy")!.disabled).toContain(path);
    expect(disabledSkills(agents)).toEqual(["mine", "ours"]);
  });

  it("with an array, locks only the surfaces it names", async () => {
    const skillsOnly = await discover({
      ...everything,
      ...managedSettings({ strictPluginOnlyCustomization: ["skills", "hooks", "future-thing"] }),
    });
    expect(disabledSkills(skillsOnly.skills)).toHaveLength(4);
    expect(disabledSkills(skillsOnly.agents)).toEqual([]);

    const agentsOnly = await discover({
      ...everything,
      ...managedSettings({ strictPluginOnlyCustomization: ["agents"] }),
    });
    expect(disabledSkills(agentsOnly.skills)).toEqual([]);
    expect(disabledSkills(agentsOnly.agents)).toEqual(["mine", "ours"]);
  });

  it("is ignored outside managed settings", async () => {
    const { skills, agents } = await discover({
      ...everything,
      [`${HOME}/.claude/settings.json`]: JSON.stringify({ strictPluginOnlyCustomization: true }),
    });
    expect(disabledSkills(skills)).toEqual([]);
    expect(disabledSkills(agents)).toEqual([]);
  });

  it("stops a blocked skill from shadowing one that still loads", async () => {
    const { skills } = await discover({
      ...managedSettings({ strictPluginOnlyCustomization: ["skills"] }),
      [`${HOME}/.claude/skills/deploy/SKILL.md`]: "---\nname: deploy\n---\n",
      [`${FOLDER}/.claude/skills/deploy/SKILL.md`]: "---\nname: deploy\n---\n",
    });
    expect(skills.every((s) => s.shadowedBy === undefined && s.disabled)).toBe(true);
  });
});

describe("skillOverrides", () => {
  it("turns off a skill or command set to off, and leaves other states loaded", async () => {
    const local = `${FOLDER}/.claude/settings.local.json`;
    const { skills } = await discover({
      [`${FOLDER}/.claude/skills/deploy/SKILL.md`]: "---\nname: deploy\n---\n",
      [`${FOLDER}/.claude/skills/legacy/SKILL.md`]: "---\nname: legacy\n---\n",
      [`${FOLDER}/.claude/commands/ship.md`]: "Ship.",
      [local]: JSON.stringify({
        skillOverrides: { deploy: "off", legacy: "name-only", ship: "off" },
      }),
    });

    expect(skills.map((s) => [s.name, s.disabled])).toEqual([
      ["deploy", `turned off by skillOverrides in ${local}`],
      ["legacy", undefined],
      ["ship", `turned off by skillOverrides in ${local}`],
    ]);
  });

  it("lets the higher-precedence file decide each skill", async () => {
    const { skills } = await discover({
      ...managedSettings({ skillOverrides: { deploy: "on" } }),
      [`${FOLDER}/.claude/skills/deploy/SKILL.md`]: "---\nname: deploy\n---\n",
      [`${FOLDER}/.claude/settings.local.json`]: JSON.stringify({ skillOverrides: { deploy: "off" } }),
    });
    expect(skills[0]!.disabled).toBeUndefined();
  });

  it("does not affect plugin skills or commands", async () => {
    const { skills } = await discover({
      ...acme(),
      [`${PLUGIN}/skills/lint/SKILL.md`]: "---\nname: lint\n---\n",
      [`${PLUGIN}/commands/about.md`]: "About.",
      [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
        skillOverrides: { lint: "off", "acme:lint": "off", about: "off", "acme:about": "off" },
      }),
    });
    expect(skills.map((s) => [s.name, s.disabled])).toEqual([
      ["acme:lint", undefined],
      ["acme:about", undefined],
    ]);
  });
});
