import { describe, expect, it } from "vitest";

import { resolveContext, type ResolvedContext } from "../src/index.js";
import { memfs } from "./memfs.js";

const HOME = "/home/dev";
const FOLDER = "/projects/acme/shop-api";
const FILE = "src/api/payments.ts";

function run(
  files: Record<string, string>,
  file = FILE,
  folder = FOLDER,
): Promise<ResolvedContext> {
  return resolveContext(folder, file, {
    fs: memfs(files),
    homeDir: HOME,
    platform: "linux",
  });
}

function skill(content: string): string {
  return content;
}

describe("MCP server approval state", () => {
  const mcpJson = JSON.stringify({
    mcpServers: {
      "fixture-stdio": {
        command: "echo",
        args: ["never-starts"],
        env: { FIXTURE: "1" },
      },
      "fixture-http": {
        type: "http",
        url: "https://mcp.invalid.example/fixture",
        headers: { "X-Fixture": "1" },
      },
    },
  });

  it("is unapproved when no settings file approves a .mcp.json server", async () => {
    const result = await run({ [`${FOLDER}/.mcp.json`]: mcpJson });

    expect(result.mcpServers.map((s) => [s.name, s.state])).toEqual([
      ["fixture-http", "unapproved"],
      ["fixture-stdio", "unapproved"],
    ]);
    expect(result.mcpServers[0]!.reason).toContain("enabledMcpjsonServers");
    expect(result.mcpServers[0]!.stateSource).toBeUndefined();
  });

  it("honours enabledMcpjsonServers and disabledMcpjsonServers", async () => {
    const settingsPath = `${FOLDER}/.claude/settings.json`;
    const result = await run({
      [`${FOLDER}/.mcp.json`]: mcpJson,
      [settingsPath]: JSON.stringify({
        enableAllProjectMcpServers: false,
        enabledMcpjsonServers: ["fixture-stdio"],
        disabledMcpjsonServers: ["fixture-http"],
      }),
    });

    const byName = new Map(result.mcpServers.map((s) => [s.name, s]));
    expect(byName.get("fixture-stdio")).toMatchObject({
      state: "enabled",
      stateKey: "enabledMcpjsonServers",
      stateSource: settingsPath,
    });
    expect(byName.get("fixture-http")).toMatchObject({
      state: "disabled",
      stateKey: "disabledMcpjsonServers",
      stateSource: settingsPath,
    });
    expect(byName.get("fixture-stdio")!.reason).toBe(
      `approved by enabledMcpjsonServers in ${settingsPath}`,
    );
  });

  it("enables every .mcp.json server when enableAllProjectMcpServers is set in any layer", async () => {
    const userSettings = `${HOME}/.claude/settings.json`;
    const result = await run({
      [`${FOLDER}/.mcp.json`]: mcpJson,
      [userSettings]: JSON.stringify({ enableAllProjectMcpServers: true }),
    });

    for (const server of result.mcpServers) {
      expect(server.state).toBe("enabled");
      expect(server.stateKey).toBe("enableAllProjectMcpServers");
      expect(server.stateSource).toBe(userSettings);
    }
  });

  it("lets disabledMcpjsonServers in one layer beat enableAllProjectMcpServers in another", async () => {
    const localSettings = `${FOLDER}/.claude/settings.local.json`;
    const result = await run({
      [`${FOLDER}/.mcp.json`]: mcpJson,
      [`${HOME}/.claude/settings.json`]: JSON.stringify({
        enableAllProjectMcpServers: true,
        enabledMcpjsonServers: ["fixture-http"],
      }),
      [localSettings]: JSON.stringify({ disabledMcpjsonServers: ["fixture-http"] }),
    });

    const byName = new Map(result.mcpServers.map((s) => [s.name, s]));
    expect(byName.get("fixture-http")).toMatchObject({
      state: "disabled",
      stateKey: "disabledMcpjsonServers",
      stateSource: localSettings,
    });
    expect(byName.get("fixture-stdio")!.state).toBe("enabled");
  });

  it("reports the highest-precedence settings file that decided the state", async () => {
    const localSettings = `${FOLDER}/.claude/settings.local.json`;
    const result = await run({
      [`${FOLDER}/.mcp.json`]: mcpJson,
      [`${HOME}/.claude/settings.json`]: JSON.stringify({
        enabledMcpjsonServers: ["fixture-stdio"],
      }),
      [localSettings]: JSON.stringify({ enabledMcpjsonServers: ["fixture-stdio"] }),
    });

    const stdio = result.mcpServers.find((s) => s.name === "fixture-stdio")!;
    expect(stdio.stateSource).toBe(localSettings);
  });

  it("always enables user-scoped servers and keeps env, headers and type", async () => {
    const result = await run({
      [`${FOLDER}/.mcp.json`]: mcpJson,
      [`${HOME}/.claude.json`]: JSON.stringify({
        mcpServers: { memory: { command: "mcp-memory", env: { DEBUG: "1" } } },
        projects: {
          [FOLDER]: {
            mcpServers: {
              scratch: { type: "sse", url: "http://localhost:4011", headers: { A: "b" } },
            },
          },
        },
      }),
    });

    const byName = new Map(result.mcpServers.map((s) => [s.name, s]));
    expect(byName.get("memory")).toMatchObject({
      layer: "user",
      state: "enabled",
      transport: "stdio",
      target: "mcp-memory",
      env: { DEBUG: "1" },
    });
    expect(byName.get("memory")!.reason).toContain("user-scoped servers need no approval");
    expect(byName.get("scratch")).toMatchObject({
      layer: "local",
      state: "enabled",
      type: "sse",
      transport: "sse",
      headers: { A: "b" },
    });

    // `.mcp.json` entries keep their declared shape too.
    expect(byName.get("fixture-stdio")).toMatchObject({
      transport: "stdio",
      target: "echo never-starts",
      env: { FIXTURE: "1" },
    });
    expect(byName.get("fixture-stdio")!.type).toBeUndefined();
    expect(byName.get("fixture-http")).toMatchObject({
      type: "http",
      transport: "http",
      target: "https://mcp.invalid.example/fixture",
      headers: { "X-Fixture": "1" },
    });
  });
});

describe("skill discovery", () => {
  it("finds personal, synced, project, nested and plugin skills", async () => {
    const result = await run(
      {
        [`${HOME}/.claude/skills/tidy/SKILL.md`]: skill(
          "---\nname: tidy\ndescription: Tidy up\n---\n",
        ),
        [`${HOME}/.claude/skills/synced/abc-123_def-456/docs/SKILL.md`]: skill(
          "---\nname: docs\ndescription: Living docs\n---\n",
        ),
        [`${HOME}/.claude/skills/synced/abc-123_def-456/manifest.json`]: "{}",
        [`${FOLDER}/.claude/skills/deploy/SKILL.md`]: "no frontmatter here",
        [`${FOLDER}/src/.claude/skills/scaffold/SKILL.md`]: skill(
          "---\nname: scaffold\n---\n",
        ),
        [`${HOME}/.claude/plugins/installed_plugins.json`]: JSON.stringify({
          version: 2,
          plugins: { "hookify@official": { version: "1.0.0" } },
        }),
        [`${HOME}/.claude/plugins/marketplaces/official/plugins/hookify/skills/writing-rules/SKILL.md`]:
          skill("---\nname: writing-rules\ndescription: Hook rules\n---\n"),
      },
      "src/api/payments.ts",
    );

    expect(
      result.skills.map((s) => [s.name, s.source, s.layer, s.shortName]),
    ).toEqual([
      ["tidy", "personal", "user", "tidy"],
      ["anthropic-skills:docs", "synced", "user", "docs"],
      ["deploy", "project", "project", "deploy"],
      ["src:scaffold", "nested", "directory", "scaffold"],
      ["hookify:writing-rules", "plugin", "user", "writing-rules"],
    ]);

    const nested = result.skills.find((s) => s.source === "nested")!;
    expect(nested.subdir).toBe("src");
    expect(nested.path).toBe(`${FOLDER}/src/.claude/skills/scaffold/SKILL.md`);

    const plugin = result.skills.find((s) => s.source === "plugin")!;
    expect(plugin.plugin).toBe("hookify");
  });

  it("collects a nested skill for every directory down to the target", async () => {
    const result = await run(
      {
        [`${FOLDER}/apps/.claude/skills/build/SKILL.md`]: "---\nname: build\n---\n",
        [`${FOLDER}/apps/web/.claude/skills/build/SKILL.md`]: "---\nname: build\n---\n",
      },
      "apps/web/src/main.ts",
    );

    expect(result.skills.map((s) => s.name)).toEqual([
      "apps:build",
      "apps/web:build",
    ]);
    // Namespaced skills never collide, so neither is shadowed.
    expect(result.skills.every((s) => s.shadowedBy === undefined)).toBe(true);
  });

  it("does not reach nested skills below the target", async () => {
    const result = await run(
      { [`${FOLDER}/apps/web/.claude/skills/build/SKILL.md`]: "---\nname: build\n---\n" },
      "apps/main.ts",
    );
    expect(result.skills).toEqual([]);
  });

  it("collects nested skills for a directory target itself", async () => {
    const result = await resolveContext(FOLDER, "apps/web", {
      fs: memfs({
        [`${FOLDER}/apps/web/.claude/skills/build/SKILL.md`]: "---\nname: build\n---\n",
      }),
      homeDir: HOME,
      platform: "linux",
      targetKind: "directory",
    });
    expect(result.skills.map((s) => s.name)).toEqual(["apps/web:build"]);
  });

  describe("plugin skills", () => {
    const marketplace = `${HOME}/.claude/plugins/marketplaces/official`;
    const files = {
      [`${marketplace}/plugins/hookify/skills/writing-rules/SKILL.md`]:
        "---\nname: writing-rules\n---\n",
      [`${marketplace}/external_plugins/telegram/skills/access/SKILL.md`]:
        "---\nname: access\n---\n",
    };

    it("reports none when installed_plugins.json is missing", async () => {
      expect((await run(files)).skills).toEqual([]);
    });

    it("reports none when installed_plugins.json lists no plugins", async () => {
      // The shape seen on a machine with marketplaces downloaded but nothing
      // installed; the real CLI lists no plugin skills there either.
      const result = await run({
        ...files,
        [`${HOME}/.claude/plugins/installed_plugins.json`]: JSON.stringify({
          version: 2,
          plugins: {},
        }),
      });
      expect(result.skills).toEqual([]);
    });

    it("reports only the installed plugins, from either marketplace subdir", async () => {
      const result = await run({
        ...files,
        [`${HOME}/.claude/plugins/installed_plugins.json`]: JSON.stringify({
          version: 2,
          plugins: { "telegram@official": true },
        }),
      });
      expect(result.skills.map((s) => [s.name, s.plugin])).toEqual([
        ["telegram:access", "telegram"],
      ]);
    });

    it("follows an explicit install path and an enabled: false flag", async () => {
      const result = await run({
        [`/opt/plugins/formatter/skills/tidy/SKILL.md`]: "---\nname: tidy\n---\n",
        ...files,
        [`${HOME}/.claude/plugins/installed_plugins.json`]: JSON.stringify({
          version: 2,
          plugins: {
            "formatter@company": { installPath: "/opt/plugins/formatter" },
            "hookify@official": { enabled: false },
          },
        }),
      });
      expect(result.skills.map((s) => s.name)).toEqual(["formatter:tidy"]);
    });

    it("treats enabledPlugins: true as installed and false as disabled", async () => {
      const enabled = (value: boolean): Record<string, string> => ({
        [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
          enabledPlugins: { "hookify@official": value },
        }),
      });

      expect((await run({ ...files, ...enabled(true) })).skills.map((s) => s.name)).toEqual([
        "hookify:writing-rules",
      ]);
      expect(
        (
          await run({
            ...files,
            [`${HOME}/.claude/plugins/installed_plugins.json`]: JSON.stringify({
              plugins: { "hookify@official": true },
            }),
            ...enabled(false),
          })
        ).skills,
      ).toEqual([]);
    });

    it("finds a plugin copied into the version cache", async () => {
      const result = await run({
        [`${HOME}/.claude/plugins/cache/official/hookify/1.2.0/skills/writing-rules/SKILL.md`]:
          "---\nname: writing-rules\n---\n",
        [`${HOME}/.claude/plugins/installed_plugins.json`]: JSON.stringify({
          plugins: { "hookify@official": true },
        }),
      });
      expect(result.skills.map((s) => s.name)).toEqual(["hookify:writing-rules"]);
    });
  });

  it("namespaces every synced skill as anthropic-skills:<name>", async () => {
    const bucket = `${HOME}/.claude/skills/synced/abc-123_def-456`;
    const result = await run({
      [`${bucket}/manifest.json`]: JSON.stringify({
        skills: [{ skillId: "pdf", name: "pdf", source: "anthropic" }],
      }),
      [`${bucket}/pdf/SKILL.md`]: "---\nname: pdf\n---\n",
      [`${bucket}/xlsx/SKILL.md`]: "---\nname: xlsx\n---\n",
    });

    expect(result.skills.map((s) => [s.name, s.shortName])).toEqual([
      ["anthropic-skills:pdf", "pdf"],
      ["anthropic-skills:xlsx", "xlsx"],
    ]);
  });

  it("shadows a project skill with the personal skill of the same name", async () => {
    const personalPath = `${HOME}/.claude/skills/commit/SKILL.md`;
    const result = await run({
      [personalPath]: "---\nname: commit\ndescription: personal\n---\n",
      [`${FOLDER}/.claude/skills/commit/SKILL.md`]:
        "---\nname: commit\ndescription: project\n---\n",
    });

    const [personal, project] = result.skills;
    expect(personal!.shadowedBy).toBeUndefined();
    // Docs: "Enterprise over personal, and personal over project."
    expect(project!.shadowedBy).toEqual({ path: personalPath, layer: "user" });
  });

  it("shadows on the directory name even when the display name differs", async () => {
    const result = await run({
      [`${HOME}/.claude/skills/review/SKILL.md`]: "---\nname: code-review\n---\n",
      [`${FOLDER}/.claude/skills/review/SKILL.md`]: "---\nname: review-pr\n---\n",
    });

    expect(result.skills.map((s) => [s.name, s.shortName])).toEqual([
      ["code-review", "review"],
      ["review-pr", "review"],
    ]);
    expect(result.skills[1]!.shadowedBy?.layer).toBe("user");
  });

  it("parses allowed-tools as a comma list, a flow list or a YAML block list", async () => {
    const result = await run({
      [`${HOME}/.claude/skills/a/SKILL.md`]: "---\nname: a\nallowed-tools: Read, Grep\n---\n",
      [`${HOME}/.claude/skills/b/SKILL.md`]: "---\nname: b\nallowed-tools: [Read, Bash]\n---\n",
      [`${HOME}/.claude/skills/c/SKILL.md`]:
        "---\nname: c\nallowed-tools:\n  - Read\n  - Write\ndescription: block list\n---\n",
      [`${HOME}/.claude/skills/d/SKILL.md`]: "---\nname: d\n---\n",
    });

    expect(result.skills.map((s) => [s.name, s.allowedTools])).toEqual([
      ["a", ["Read", "Grep"]],
      ["b", ["Read", "Bash"]],
      ["c", ["Read", "Write"]],
      ["d", undefined],
    ]);
    expect(result.skills[2]!.description).toBe("block list");
  });
});

describe("subagent frontmatter", () => {
  it("keeps every supported field", async () => {
    const result = await run({
      [`${FOLDER}/.claude/agents/reviewer.md`]: [
        "---",
        "name: reviewer",
        "description: Reviews code.",
        "tools: Read, Grep, Glob",
        "disallowedTools: Write",
        "model: sonnet",
        "permissionMode: plan",
        "maxTurns: 12",
        "skills:",
        "  - code-review",
        "  - simplify",
        "mcpServers: [linear, github]",
        "memory: project",
        "background: true",
        "effort: high",
        "isolation: worktree",
        "color: blue",
        "---",
        "You review code.",
      ].join("\n"),
    });

    expect(result.agents).toEqual([
      {
        path: `${FOLDER}/.claude/agents/reviewer.md`,
        layer: "project",
        name: "reviewer",
        description: "Reviews code.",
        tools: ["Read", "Grep", "Glob"],
        disallowedTools: ["Write"],
        model: "sonnet",
        permissionMode: "plan",
        maxTurns: 12,
        skills: ["code-review", "simplify"],
        mcpServers: ["linear", "github"],
        memory: "project",
        background: true,
        effort: "high",
        isolation: "worktree",
        color: "blue",
      },
    ]);
  });

  it("reads a YAML block list for tools as well as a comma list", async () => {
    const result = await run({
      [`${FOLDER}/.claude/agents/explorer.md`]:
        "---\nname: explorer\ntools:\n  - Read\n  - Glob\nmodel: opus\n---\n",
    });
    expect(result.agents[0]).toMatchObject({
      tools: ["Read", "Glob"],
      model: "opus",
    });
  });

  it("omits fields the file does not set", async () => {
    const result = await run({
      [`${FOLDER}/.claude/agents/plain.md`]: "---\nname: plain\n---\n",
    });
    expect(result.agents).toEqual([
      { path: `${FOLDER}/.claude/agents/plain.md`, layer: "project", name: "plain" },
    ]);
  });

  it("shadows a user subagent with the project subagent of the same name", async () => {
    const projectPath = `${FOLDER}/.claude/agents/reviewer.md`;
    const result = await run({
      [`${HOME}/.claude/agents/reviewer.md`]: "---\nname: reviewer\n---\n",
      [projectPath]: "---\nname: reviewer\n---\n",
    });

    const [user, project] = result.agents;
    // Docs (/sub-agents): `.claude/agents/` outranks `~/.claude/agents/`.
    expect(user!.shadowedBy).toEqual({ path: projectPath, layer: "project" });
    expect(project!.shadowedBy).toBeUndefined();
  });

  it("leaves subagents with distinct names unshadowed", async () => {
    const result = await run({
      [`${HOME}/.claude/agents/explorer.md`]: "---\nname: explorer\n---\n",
      [`${FOLDER}/.claude/agents/reviewer.md`]: "---\nname: reviewer\n---\n",
    });
    expect(result.agents.every((a) => a.shadowedBy === undefined)).toBe(true);
  });
});
