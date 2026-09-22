import { describe, expect, it } from "vitest";

import {
  CONFIG_LAYER_PRECEDENCE,
  resolveContext,
  type ResolvedContext,
} from "../src/index.js";
import { projectSlug } from "../src/memory.js";
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

/** Same as `run`, but resolving a directory target. */
function runDir(
  files: Record<string, string>,
  dir = "src/api",
  folder = FOLDER,
): Promise<ResolvedContext> {
  return resolveContext(folder, dir, {
    fs: memfs(files),
    homeDir: HOME,
    platform: "linux",
    targetKind: "directory",
  });
}

function paths(entries: { path: string }[]): string[] {
  return entries.map((entry) => entry.path);
}

describe("resolveContext", () => {
  it("orders config layers lowest to highest precedence", () => {
    expect(CONFIG_LAYER_PRECEDENCE).toEqual([
      "managed",
      "user",
      "project",
      "local",
      "directory",
    ]);
  });

  it("normalises a relative file to an absolute path", async () => {
    const result = await run({});
    expect(result.folder).toBe(FOLDER);
    expect(result.file).toBe(`${FOLDER}/${FILE}`);
    expect(result.targetKind).toBe("file");
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a directory target as such", async () => {
    const result = await runDir({});
    expect(result.file).toBe(`${FOLDER}/src/api`);
    expect(result.targetKind).toBe("directory");
  });

  it("keeps an already absolute file as given", async () => {
    const result = await run({}, `${FOLDER}/src/api/payments.ts`);
    expect(result.file).toBe(`${FOLDER}/src/api/payments.ts`);
  });

  describe("memory", () => {
    it("orders CLAUDE.md files lowest precedence first", async () => {
      const result = await run({
        "/etc/claude-code/CLAUDE.md": "managed",
        [`${HOME}/.claude/CLAUDE.md`]: "user",
        [`${FOLDER}/CLAUDE.md`]: "project root",
        [`${FOLDER}/.claude/CLAUDE.md`]: "project dot-claude",
        [`${FOLDER}/CLAUDE.local.md`]: "local",
        [`${FOLDER}/src/CLAUDE.md`]: "src",
        [`${FOLDER}/src/api/CLAUDE.md`]: "api",
      });

      expect(paths(result.memory)).toEqual([
        "/etc/claude-code/CLAUDE.md",
        `${HOME}/.claude/CLAUDE.md`,
        `${FOLDER}/CLAUDE.md`,
        `${FOLDER}/.claude/CLAUDE.md`,
        `${FOLDER}/CLAUDE.local.md`,
        `${FOLDER}/src/CLAUDE.md`,
        `${FOLDER}/src/api/CLAUDE.md`,
      ]);
      expect(result.memory.map((entry) => entry.layer)).toEqual([
        "managed",
        "user",
        "project",
        "project",
        "local",
        "directory",
        "directory",
      ]);
      expect(result.memory.every((entry) => entry.kind === "claude-md")).toBe(true);
      expect(result.memory[0]?.bytes).toBe(7);
    });

    it("scopes directory CLAUDE.md files to the selected file", async () => {
      const result = await run({
        [`${FOLDER}/CLAUDE.md`]: "root",
        [`${FOLDER}/src/api/CLAUDE.md`]: "api",
        [`${FOLDER}/src/web/CLAUDE.md`]: "web",
      });

      expect(paths(result.memory)).toEqual([
        `${FOLDER}/CLAUDE.md`,
        `${FOLDER}/src/api/CLAUDE.md`,
      ]);
      expect(result.memory[0]).toMatchObject({
        scopedToFile: false,
        reason: "always loaded",
      });
      expect(result.memory[1]).toMatchObject({
        scopedToFile: true,
        reason: "loaded when this file is read",
      });
    });

    it("does not duplicate the root CLAUDE.md when the file sits at the root", async () => {
      const result = await run({ [`${FOLDER}/CLAUDE.md`]: "root" }, "index.ts");
      expect(paths(result.memory)).toEqual([`${FOLDER}/CLAUDE.md`]);
      expect(result.memory[0]?.layer).toBe("project");
    });

    it("inlines @imports right after their parent, with line numbers", async () => {
      const result = await run({
        [`${FOLDER}/CLAUDE.md`]: [
          "# Shop API",
          "",
          "See @docs/style.md for conventions.",
          "And @~/.claude/personal.md too.",
        ].join("\n"),
        [`${FOLDER}/docs/style.md`]: "style rules @./deeper.md",
        [`${FOLDER}/docs/deeper.md`]: "deeper",
        [`${HOME}/.claude/personal.md`]: "personal",
      });

      expect(paths(result.memory)).toEqual([
        `${FOLDER}/CLAUDE.md`,
        `${FOLDER}/docs/style.md`,
        `${FOLDER}/docs/deeper.md`,
        `${HOME}/.claude/personal.md`,
      ]);
      expect(result.memory[1]).toMatchObject({
        kind: "import",
        layer: "project",
        importedBy: `${FOLDER}/CLAUDE.md`,
        importedAtLine: 3,
        reason: "inlined at line 3 of CLAUDE.md",
        scopedToFile: false,
      });
      expect(result.memory[2]).toMatchObject({
        importedBy: `${FOLDER}/docs/style.md`,
        importedAtLine: 1,
        reason: "inlined at line 1 of style.md",
      });
      expect(result.memory[3]?.importedAtLine).toBe(4);
      expect(result.diagnostics).toEqual([]);
    });

    it("ignores email addresses and fenced code when scanning for imports", async () => {
      const result = await run({
        [`${FOLDER}/CLAUDE.md`]: [
          "Contact mail@cesarvarela.com for access.",
          "",
          "```sh",
          "cat @docs/not-an-import.md",
          "```",
        ].join("\n"),
      });

      expect(paths(result.memory)).toEqual([`${FOLDER}/CLAUDE.md`]);
      expect(result.diagnostics).toEqual([]);
    });

    it("reports a missing import as a diagnostic and skips it", async () => {
      const result = await run({
        [`${FOLDER}/CLAUDE.md`]: "Read @docs/missing.md first.",
      });

      expect(paths(result.memory)).toEqual([`${FOLDER}/CLAUDE.md`]);
      expect(result.diagnostics).toEqual([
        `${FOLDER}/docs/missing.md: imported at line 1 of ${FOLDER}/CLAUDE.md but not found`,
      ]);
    });

    it("includes a directory target's own CLAUDE.md", async () => {
      const result = await runDir({
        [`${FOLDER}/CLAUDE.md`]: "root",
        [`${FOLDER}/src/CLAUDE.md`]: "src",
        [`${FOLDER}/src/api/CLAUDE.md`]: "api",
        [`${FOLDER}/src/web/CLAUDE.md`]: "web",
      });

      expect(paths(result.memory)).toEqual([
        `${FOLDER}/CLAUDE.md`,
        `${FOLDER}/src/CLAUDE.md`,
        `${FOLDER}/src/api/CLAUDE.md`,
      ]);
      expect(result.memory[2]).toMatchObject({
        layer: "directory",
        scopedToFile: true,
        reason: "loaded when files in this folder are read",
      });
    });

    it("does not duplicate the root CLAUDE.md for the project root as target", async () => {
      const result = await runDir({ [`${FOLDER}/CLAUDE.md`]: "root" }, ".");
      expect(result.file).toBe(FOLDER);
      expect(paths(result.memory)).toEqual([`${FOLDER}/CLAUDE.md`]);
      expect(result.memory[0]?.layer).toBe("project");
    });

    it("reads the project memory directory under the slugged project path", async () => {
      const slug = "-projects-acme-shop-api";
      const result = await run({
        [`${HOME}/.claude/projects/${slug}/memory/MEMORY.md`]: "- [Ports](ports.md)",
        [`${HOME}/.claude/projects/${slug}/memory/ports.md`]: "use 4000",
      });

      expect(result.memory).toHaveLength(2);
      expect(result.memory[0]).toMatchObject({
        path: `${HOME}/.claude/projects/${slug}/memory/MEMORY.md`,
        kind: "memory-index",
        layer: "user",
        reason: "always loaded",
        content: "- [Ports](ports.md)",
      });
      expect(result.memory[1]).toMatchObject({
        kind: "memory-file",
        layer: "user",
        reason: "recalled on demand",
        bytes: 8,
      });
    });
  });

  describe("settings and permissions", () => {
    const projectSettings = JSON.stringify({
      permissions: {
        allow: ["Edit(src/**)", "Read(//etc/hosts)"],
        ask: ["Bash(npm run *)"],
      },
    });

    it("collects settings per layer and records a diagnostic for bad JSON", async () => {
      const result = await run({
        [`${FOLDER}/.claude/settings.json`]: projectSettings,
        [`${FOLDER}/.claude/settings.local.json`]: "{ not json ",
      });

      expect(paths(result.settings)).toEqual([`${FOLDER}/.claude/settings.json`]);
      expect(result.diagnostics).toEqual([
        `${FOLDER}/.claude/settings.local.json: invalid JSON`,
      ]);
    });

    it("tolerates comments and trailing commas", async () => {
      const result = await run({
        [`${FOLDER}/.claude/settings.json`]: `{
          // project settings
          "model": "opus", /* inline */
        }`,
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.settings[0]?.values).toEqual({ model: "opus" });
    });

    it("matches path specifiers against the selected file", async () => {
      const result = await run({
        [`${HOME}/.claude/settings.json`]: JSON.stringify({
          permissions: { deny: ["Read(./.env)", "Read(src/**/*.ts)"] },
        }),
        [`${FOLDER}/.claude/settings.json`]: projectSettings,
      });

      const byRule = new Map(result.permissions.map((rule) => [rule.rule, rule]));
      expect(byRule.get("Edit(src/**)")?.matchesFile).toBe(true);
      expect(byRule.get("Read(src/**/*.ts)")?.matchesFile).toBe(true);
      expect(byRule.get("Read(./.env)")?.matchesFile).toBe(false);
      expect(byRule.get("Read(//etc/hosts)")?.matchesFile).toBe(false);
      expect(byRule.get("Bash(npm run *)")?.matchesFile).toBe(false);

      expect(byRule.get("Edit(src/**)")).toMatchObject({
        tool: "Edit",
        specifier: "src/**",
        decision: "allow",
        layer: "project",
      });
    });

    it("matches a rule against a directory target when it could cover its files", async () => {
      const result = await runDir({
        [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
          permissions: {
            deny: [
              "Read(src/api/**)",
              "Read(src/**/*.ts)",
              "Read(src/api)",
              "Read(src)",
              "Read(**/*.env)",
              "Read(src/web/**)",
              "Read(src/api.ts)",
              "Read(*.ts)",
              "Read(//etc/hosts)",
              "Bash(ls src/api)",
            ],
          },
        }),
      });

      const matches = (rule: string): boolean | undefined =>
        result.permissions.find((entry) => entry.rule === rule)?.matchesFile;

      // The glob lands inside the folder, names it, or names an ancestor.
      expect(matches("Read(src/api/**)")).toBe(true);
      expect(matches("Read(src/**/*.ts)")).toBe(true);
      expect(matches("Read(src/api)")).toBe(true);
      expect(matches("Read(src)")).toBe(true);
      expect(matches("Read(**/*.env)")).toBe(true);
      // Siblings, shallower paths and non-file tools stay out.
      expect(matches("Read(src/web/**)")).toBe(false);
      expect(matches("Read(src/api.ts)")).toBe(false);
      expect(matches("Read(*.ts)")).toBe(false);
      expect(matches("Read(//etc/hosts)")).toBe(false);
      expect(matches("Bash(ls src/api)")).toBe(false);
    });

    it("matches every path rule against the project root as target", async () => {
      const result = await runDir(
        {
          [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
            permissions: { deny: ["Read(./.env)", "Read(packages/*/src)"] },
          }),
        },
        ".",
      );

      expect(result.permissions.every((rule) => rule.matchesFile)).toBe(true);
    });

    it("orders rules by layer and marks higher-layer overrides", async () => {
      const result = await run({
        [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
          permissions: { ask: ["Bash(npm run *)"] },
        }),
        [`${FOLDER}/.claude/settings.local.json`]: JSON.stringify({
          permissions: { allow: ["Bash(npm run *)"] },
        }),
      });

      expect(result.permissions.map((rule) => rule.layer)).toEqual([
        "project",
        "local",
      ]);
      expect(result.permissions[0]).toMatchObject({
        decision: "ask",
        overridden: true,
        overriddenBy: "local",
      });
      expect(result.permissions[1]).toMatchObject({
        decision: "allow",
        overridden: false,
      });
    });

    it("never lets a higher-layer allow override a deny", async () => {
      const result = await run({
        [`${HOME}/.claude/settings.json`]: JSON.stringify({
          permissions: { deny: ["Read(./.env)"] },
        }),
        [`${FOLDER}/.claude/settings.local.json`]: JSON.stringify({
          permissions: { allow: ["Read(./.env)"] },
        }),
      });

      expect(result.permissions[0]).toMatchObject({
        layer: "user",
        decision: "deny",
        overridden: false,
      });
      expect(result.permissions[0]?.overriddenBy).toBeUndefined();
    });

    it("parses a bare tool rule with no specifier", async () => {
      const result = await run({
        [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
          permissions: { allow: ["WebFetch", "Edit"] },
        }),
      });

      expect(result.permissions[0]).toMatchObject({
        tool: "WebFetch",
        matchesFile: false,
      });
      expect(result.permissions[0]?.specifier).toBeUndefined();
      expect(result.permissions[1]).toMatchObject({ tool: "Edit", matchesFile: true });
    });
  });

  describe("hooks", () => {
    it("knows which hooks fire on an edit", async () => {
      const result = await run({
        [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: "Edit|Write",
                hooks: [{ type: "command", command: "prettier --check", timeout: 30 }],
              },
              { matcher: "Bash", hooks: [{ type: "command", command: "audit.sh" }] },
            ],
            PostToolUse: [{ hooks: [{ type: "command", command: "tsc --noEmit" }] }],
            SessionStart: [
              { matcher: "*", hooks: [{ type: "command", command: "greet.sh" }] },
            ],
          },
        }),
      });

      expect(result.hooks).toHaveLength(4);
      expect(result.hooks[0]).toMatchObject({
        event: "PreToolUse",
        matcher: "Edit|Write",
        command: "prettier --check",
        timeoutSeconds: 30,
        firesOnEdit: true,
        layer: "project",
      });
      expect(result.hooks[1]).toMatchObject({
        matcher: "Bash",
        command: "audit.sh",
        firesOnEdit: false,
      });
      expect(result.hooks[1]?.timeoutSeconds).toBeUndefined();
      expect(result.hooks[2]).toMatchObject({
        event: "PostToolUse",
        command: "tsc --noEmit",
        firesOnEdit: true,
      });
      expect(result.hooks[2]?.matcher).toBeUndefined();
      expect(result.hooks[3]).toMatchObject({
        event: "SessionStart",
        firesOnEdit: false,
      });
    });
  });

  describe("discovery", () => {
    it("finds skills and agents at the user and project layers", async () => {
      const result = await run({
        [`${HOME}/.claude/skills/review/SKILL.md`]:
          "---\nname: code-review\ndescription: Review a diff\n---\nbody",
        [`${FOLDER}/.claude/skills/deploy/SKILL.md`]: "no frontmatter here",
        [`${HOME}/.claude/agents/explore.md`]:
          "---\ndescription: Read-only search\n---\n",
        [`${FOLDER}/.claude/agents/planner.md`]: "---\nname: Plan\n---\n",
      });

      expect(result.skills).toEqual([
        {
          path: `${HOME}/.claude/skills/review/SKILL.md`,
          layer: "user",
          name: "code-review",
          description: "Review a diff",
        },
        {
          path: `${FOLDER}/.claude/skills/deploy/SKILL.md`,
          layer: "project",
          name: "deploy",
        },
      ]);
      expect(result.agents).toEqual([
        {
          path: `${HOME}/.claude/agents/explore.md`,
          layer: "user",
          name: "explore",
          description: "Read-only search",
        },
        { path: `${FOLDER}/.claude/agents/planner.md`, layer: "project", name: "Plan" },
      ]);
    });

    it("finds MCP servers from .mcp.json and ~/.claude.json", async () => {
      const result = await run({
        [`${FOLDER}/.mcp.json`]: JSON.stringify({
          mcpServers: {
            linear: { type: "sse", url: "https://mcp.linear.app/sse" },
            db: { command: "node", args: ["db-server.js", "--port=4010"] },
          },
        }),
        [`${HOME}/.claude.json`]: JSON.stringify({
          mcpServers: { memory: { command: "mcp-memory" } },
          projects: {
            [FOLDER]: { mcpServers: { scratch: { url: "http://localhost:4011" } } },
          },
        }),
      });

      expect(result.mcpServers).toEqual([
        {
          path: `${HOME}/.claude.json`,
          layer: "user",
          name: "memory",
          transport: "stdio",
          target: "mcp-memory",
        },
        {
          path: `${FOLDER}/.mcp.json`,
          layer: "project",
          name: "db",
          transport: "stdio",
          target: "node db-server.js --port=4010",
        },
        {
          path: `${FOLDER}/.mcp.json`,
          layer: "project",
          name: "linear",
          transport: "sse",
          target: "https://mcp.linear.app/sse",
        },
        {
          path: `${HOME}/.claude.json`,
          layer: "local",
          name: "scratch",
          transport: "http",
          target: "http://localhost:4011",
        },
      ]);
    });
  });

  describe("platform defaults", () => {
    it("uses the darwin managed paths", async () => {
      const result = await resolveContext(FOLDER, FILE, {
        fs: memfs({
          "/Library/Application Support/ClaudeCode/CLAUDE.md": "managed",
          "/Library/Application Support/ClaudeCode/managed-settings.json":
            JSON.stringify({ permissions: { deny: ["Bash(curl:*)"] } }),
        }),
        homeDir: HOME,
        platform: "darwin",
      });

      expect(paths(result.memory)).toEqual([
        "/Library/Application Support/ClaudeCode/CLAUDE.md",
      ]);
      expect(result.permissions[0]).toMatchObject({
        layer: "managed",
        rule: "Bash(curl:*)",
        tool: "Bash",
        specifier: "curl:*",
        decision: "deny",
      });
    });

    it("slugs project paths per platform", () => {
      expect(projectSlug("/Users/x/proj", "linux")).toBe("-Users-x-proj");
      expect(projectSlug("C:\\work\\shop", "win32")).toBe("C--work-shop");
    });

    it("honours an explicit managed settings path override", async () => {
      const result = await resolveContext(FOLDER, FILE, {
        fs: memfs({ "/opt/policy.json": JSON.stringify({ model: "sonnet" }) }),
        homeDir: HOME,
        platform: "linux",
        managedSettingsPath: "/opt/policy.json",
      });

      expect(result.settings).toEqual([
        { path: "/opt/policy.json", layer: "managed", values: { model: "sonnet" } },
      ]);
    });
  });
});
