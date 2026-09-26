import { describe, expect, it } from "vitest";

import { resolveContext, type InstructionFilesMode, type ResolvedContext } from "../src/index.js";
import {
  REASON_AGENTS_ALONGSIDE,
  REASON_AGENTS_INSTEAD,
  REASON_MANAGED_INLINE,
  projectSlug,
} from "../src/memory.js";
import { memfs } from "./memfs.js";

// AGENTS.md, the managed `claudeMd` setting and auto memory settings.
// Docs: /memory#agents-md, /settings-reference. Checked against Claude Code
// 2.1.280 with `/context` and by asking the model which files it saw.

const HOME = "/home/dev";
const MANAGED = "/etc/claude-code/managed-settings.json";

/** Resolves `target` in `folder`; a target without an extension is a directory. */
function run(
  files: Record<string, string>,
  folder = "/p",
  target = ".",
): Promise<ResolvedContext> {
  return resolveContext(folder, target, {
    fs: memfs(files),
    homeDir: HOME,
    platform: "linux",
    targetKind: /\.\w+$/.test(target) ? "file" : "directory",
  });
}

/** `~/.claude/settings.json` choosing an instruction files mode. */
function userMode(mode: InstructionFilesMode): Record<string, string> {
  return {
    [`${HOME}/.claude/settings.json`]: JSON.stringify({
      pluginConfigs: { "agents-md@builtin": { options: { instructionFiles: mode } } },
    }),
  };
}

const paths = (result: ResolvedContext) => result.memory.map((m) => m.path);

describe("AGENTS.md by default (claude-md-or-agents-md)", () => {
  it("reads AGENTS.md and .claude/AGENTS.md when no CLAUDE.md is in the folder or above", async () => {
    const result = await run({
      "/p/.git/HEAD": "",
      "/p/AGENTS.md": "agents @docs/extra.md",
      "/p/docs/extra.md": "imported",
      "/p/.claude/AGENTS.md": "dot-claude agents",
      "/p/AGENTS.local.md": "never read",
      "/p/AGENTS.override.md": "never read",
      "/p/.agents/AGENTS.md": "never read",
      "/p/.agents/rules/x.md": "never read",
    });
    expect(paths(result)).toEqual(["/p/AGENTS.md", "/p/docs/extra.md", "/p/.claude/AGENTS.md"]);
    expect(result.memory[0]).toMatchObject({
      kind: "agents-md",
      layer: "project",
      loading: "always",
      scopedToFile: false,
      reason: REASON_AGENTS_INSTEAD,
    });
    expect(result.memory[1]).toMatchObject({
      kind: "import",
      importedBy: "/p/AGENTS.md",
      loading: "always",
    });
  });

  it("keeps user and managed CLAUDE.md and rules, which don't count for the check", async () => {
    const result = await run({
      "/etc/claude-code/CLAUDE.md": "managed",
      [`${HOME}/.claude/CLAUDE.md`]: "user",
      "/p/.claude/rules/style.md": "rule",
      "/p/AGENTS.md": "agents",
    });
    expect(paths(result)).toEqual([
      "/etc/claude-code/CLAUDE.md",
      `${HOME}/.claude/CLAUDE.md`,
      "/p/.claude/rules/style.md",
      "/p/AGENTS.md",
    ]);
  });

  it("reads AGENTS.md from folders above the project too, past the git root", async () => {
    const result = await run(
      { "/w/AGENTS.md": "parent", "/w/repo/.git/HEAD": "", "/w/repo/AGENTS.md": "repo" },
      "/w/repo",
    );
    expect(paths(result)).toEqual(["/w/AGENTS.md", "/w/repo/AGENTS.md"]);
  });

  it.each([
    ["/p/CLAUDE.md"],
    ["/p/.claude/CLAUDE.md"],
    ["/p/CLAUDE.local.md"],
    ["/CLAUDE.md"],
    ["/CLAUDE.local.md"],
  ])("reads CLAUDE.md files only when %s exists", async (claudeMd) => {
    const result = await run(
      { "/w/p/AGENTS.md": "agents", "/w/AGENTS.md": "parent agents", [`/w${claudeMd}`]: "x" },
      "/w/p",
    );
    expect(paths(result)).toEqual([`/w${claudeMd}`]);
  });

  it("stops reading AGENTS.md once a CLAUDE.local.md is added", async () => {
    const result = await run({ "/p/AGENTS.md": "agents", "/p/CLAUDE.local.md": "mine" });
    expect(paths(result)).toEqual(["/p/CLAUDE.local.md"]);
    expect(result.memory[0]?.kind).toBe("claude-md");
  });

  it("doesn't count a CLAUDE.md that claudeMdExcludes drops", async () => {
    const result = await run({
      "/p/CLAUDE.md": "excluded",
      "/p/AGENTS.md": "agents",
      "/p/.claude/settings.local.json": JSON.stringify({ claudeMdExcludes: ["/p/CLAUDE.md"] }),
    });
    expect(paths(result)).toEqual(["/p/AGENTS.md"]);
  });

  it("applies claudeMdExcludes to AGENTS.md and its imports", async () => {
    const result = await run({
      "/w/AGENTS.md": "other team @/w/shared.md",
      "/w/shared.md": "shared",
      "/w/p/AGENTS.md": "ours",
      "/w/p/.claude/settings.json": JSON.stringify({ claudeMdExcludes: ["/w/AGENTS.md"] }),
    }, "/w/p");
    expect(paths(result)).toEqual(["/w/p/AGENTS.md"]);
  });

  it("follows @imports inside AGENTS.md four hops deep", async () => {
    const result = await run({
      "/p/AGENTS.md": "@a.md",
      "/p/a.md": "@b.md",
      "/p/b.md": "@c.md",
      "/p/c.md": "@d.md",
      "/p/d.md": "@e.md",
      "/p/e.md": "too deep",
    });
    expect(paths(result)).toEqual(["/p/AGENTS.md", "/p/a.md", "/p/b.md", "/p/c.md", "/p/d.md"]);
  });

  describe("in a subdirectory", () => {
    const files = {
      "/p/.git/HEAD": "",
      "/p/AGENTS.md": "root agents",
      "/p/plain/AGENTS.md": "plain agents",
      "/p/plain/.claude/AGENTS.md": "not read below the project",
      "/p/local/AGENTS.md": "skipped",
      "/p/local/CLAUDE.local.md": "local claude",
      "/p/dot/AGENTS.md": "skipped",
      "/p/dot/.claude/CLAUDE.md": "dot claude",
    };

    it("reads its AGENTS.md on read when it has no CLAUDE.md of its own", async () => {
      const result = await run(files, "/p", "plain/x.ts");
      expect(paths(result)).toEqual(["/p/AGENTS.md", "/p/plain/AGENTS.md"]);
      expect(result.memory[1]).toMatchObject({
        kind: "agents-md",
        layer: "directory",
        loading: "on-read",
        scopedToFile: true,
        reason: "loaded when this file is read: no CLAUDE.md in that folder, the project folder or above it",
      });
    });

    it("reads its CLAUDE.local.md or .claude/CLAUDE.md instead when it has one", async () => {
      expect(paths(await run(files, "/p", "local/x.ts"))).toEqual([
        "/p/AGENTS.md",
        "/p/local/CLAUDE.local.md",
      ]);
      const dot = await run(files, "/p", "dot/x.ts");
      expect(paths(dot)).toEqual(["/p/AGENTS.md", "/p/dot/.claude/CLAUDE.md"]);
      expect(dot.memory[1]).toMatchObject({ layer: "directory", loading: "on-read" });
    });

    it("decides per folder along the chain", async () => {
      const result = await run(
        { "/p/a/CLAUDE.md": "a claude", "/p/a/AGENTS.md": "skipped", "/p/a/b/AGENTS.md": "b agents" },
        "/p",
        "a/b/x.ts",
      );
      expect(paths(result)).toEqual(["/p/a/CLAUDE.md", "/p/a/b/AGENTS.md"]);
    });

    it("never reads one when the project has a CLAUDE.md", async () => {
      const result = await run({ ...files, "/p/CLAUDE.md": "root" }, "/p", "plain/x.ts");
      expect(paths(result)).toEqual(["/p/CLAUDE.md"]);
    });

    it("says so for a directory target", async () => {
      const result = await run(files, "/p", "plain");
      expect(result.memory[1]?.reason).toBe(
        "loaded when files in this folder are read: no CLAUDE.md in that folder, the project folder or above it",
      );
    });
  });
});

describe("claude-md-and-agents-md", () => {
  it("reads each folder's CLAUDE.md files and rules first, then its AGENTS.md", async () => {
    const result = await run(
      {
        ...userMode("claude-md-and-agents-md"),
        "/w/CLAUDE.md": "parent",
        "/w/.claude/rules/r.md": "parent rule",
        "/w/CLAUDE.local.md": "parent local",
        "/w/AGENTS.md": "parent agents",
        "/w/p/.git/HEAD": "",
        "/w/p/CLAUDE.md": "claude\n@AGENTS.md",
        "/w/p/AGENTS.md": "agents",
        "/w/p/.claude/CLAUDE.md": "dot claude",
        "/w/p/CLAUDE.local.md": "local",
        "/w/p/.claude/rules/always.md": "rule",
        "/w/p/.claude/AGENTS.md": "dot agents",
      },
      "/w/p",
    );
    expect(paths(result)).toEqual([
      "/w/CLAUDE.md",
      "/w/.claude/rules/r.md",
      "/w/CLAUDE.local.md",
      "/w/AGENTS.md",
      "/w/p/CLAUDE.md",
      "/w/p/AGENTS.md",
      "/w/p/.claude/CLAUDE.md",
      "/w/p/CLAUDE.local.md",
      "/w/p/.claude/rules/always.md",
      "/w/p/.claude/AGENTS.md",
    ]);
    const byPath = new Map(result.memory.map((m) => [m.path, m]));
    // Imported by CLAUDE.md, so read once, as an import.
    expect(byPath.get("/w/p/AGENTS.md")).toMatchObject({ kind: "import", importedBy: "/w/p/CLAUDE.md" });
    expect(byPath.get("/w/AGENTS.md")).toMatchObject({
      kind: "agents-md",
      reason: REASON_AGENTS_ALONGSIDE,
    });
  });

  it("reads a subdirectory's AGENTS.md after its CLAUDE.md", async () => {
    const result = await run(
      { ...userMode("claude-md-and-agents-md"), "/p/sub/CLAUDE.md": "c", "/p/sub/AGENTS.md": "a" },
      "/p",
      "sub/x.ts",
    );
    expect(paths(result)).toEqual(["/p/sub/CLAUDE.md", "/p/sub/AGENTS.md"]);
    expect(result.memory[1]).toMatchObject({
      kind: "agents-md",
      loading: "on-read",
      reason: "loaded when this file is read, after that folder's CLAUDE.md files",
    });
  });
});

describe("claude-md", () => {
  it("never reads AGENTS.md", async () => {
    const result = await run(
      { ...userMode("claude-md"), "/p/AGENTS.md": "a", "/p/sub/AGENTS.md": "a" },
      "/p",
      "sub/x.ts",
    );
    expect(paths(result)).toEqual([]);
  });

  it("is what a project settings file can't choose", async () => {
    const result = await run({
      "/p/.claude/settings.json": JSON.stringify({
        pluginConfigs: { "agents-md@builtin": { options: { instructionFiles: "claude-md" } } },
      }),
      "/p/AGENTS.md": "still read",
    });
    expect(paths(result)).toEqual(["/p/AGENTS.md"]);
  });
});

describe("managed-only", () => {
  const slug = projectSlug("/w/p");
  const files = {
    ...userMode("managed-only"),
    "/etc/claude-code/CLAUDE.md": "managed",
    [MANAGED]: JSON.stringify({ claudeMd: "inline" }),
    [`${HOME}/.claude/CLAUDE.md`]: "user",
    [`${HOME}/.claude/rules/mine.md`]: "user rule",
    [`${HOME}/.claude/projects/${slug}/memory/MEMORY.md`]: "- index",
    "/w/CLAUDE.md": "parent",
    "/w/p/.git/HEAD": "",
    "/w/p/CLAUDE.md": "project",
    "/w/p/CLAUDE.local.md": "local",
    "/w/p/AGENTS.md": "agents",
    "/w/p/.claude/rules/always.md": "rule @always-import.md",
    "/w/p/.claude/rules/always-import.md": "imported",
    "/w/p/.claude/rules/src.md": '---\npaths:\n  - "src/**"\n---\nsrc rule @src-import.md',
    "/w/p/.claude/rules/src-import.md": "imported by src rule",
    "/w/p/src/CLAUDE.md": "src claude",
    "/w/p/src/AGENTS.md": "src agents",
  };

  it("loads only managed instructions and auto memory at launch", async () => {
    const result = await run(files, "/w/p", "README.md");
    expect(paths(result)).toEqual([
      "/etc/claude-code/CLAUDE.md",
      MANAGED,
      `${HOME}/.claude/projects/${slug}/memory/MEMORY.md`,
    ]);
  });

  it("still loads a subdirectory's CLAUDE.md and matching path-scoped rules on read", async () => {
    const result = await run(files, "/w/p", "src/x.ts");
    expect(paths(result)).toEqual([
      "/etc/claude-code/CLAUDE.md",
      MANAGED,
      `${HOME}/.claude/projects/${slug}/memory/MEMORY.md`,
      "/w/p/.claude/rules/src.md",
      "/w/p/.claude/rules/src-import.md",
      "/w/p/src/CLAUDE.md",
    ]);
    const byPath = new Map(result.memory.map((m) => [m.path, m]));
    expect(byPath.get("/w/p/.claude/rules/src-import.md")?.loading).toBe("on-read");
    expect(byPath.get("/w/p/src/CLAUDE.md")?.loading).toBe("on-read");
  });
});

describe("managed claudeMd", () => {
  it("loads as an inline managed entry right after the managed CLAUDE.md", async () => {
    const result = await run({
      "/etc/claude-code/CLAUDE.md": "managed file",
      [MANAGED]: JSON.stringify({ claudeMd: "# Rules\n\n- Run make lint." }),
      [`${HOME}/.claude/CLAUDE.md`]: "user",
      "/p/CLAUDE.md": "project",
    });
    expect(paths(result)).toEqual([
      "/etc/claude-code/CLAUDE.md",
      MANAGED,
      `${HOME}/.claude/CLAUDE.md`,
      "/p/CLAUDE.md",
    ]);
    expect(result.memory[1]).toMatchObject({
      kind: "inline",
      layer: "managed",
      content: "# Rules\n\n- Run make lint.",
      bytes: 25,
      summary: "# Rules",
      loading: "always",
      scopedToFile: false,
      reason: REASON_MANAGED_INLINE,
    });
  });

  it("takes the value from the last managed drop-in that sets it", async () => {
    const result = await run({
      [MANAGED]: JSON.stringify({ claudeMd: "base" }),
      "/etc/claude-code/managed-settings.d/10-team.json": JSON.stringify({ claudeMd: "team" }),
    });
    expect(result.memory).toHaveLength(1);
    expect(result.memory[0]).toMatchObject({
      path: "/etc/claude-code/managed-settings.d/10-team.json",
      content: "team",
    });
  });

  it("is ignored outside managed settings", async () => {
    const result = await run({
      [`${HOME}/.claude/settings.json`]: JSON.stringify({ claudeMd: "user" }),
      "/p/.claude/settings.json": JSON.stringify({ claudeMd: "project" }),
    });
    expect(result.memory).toEqual([]);
    expect(result.diagnostics.some((d) => d.startsWith("claudeMd ignored in"))).toBe(true);
  });
});

describe("auto memory settings", () => {
  const slug = projectSlug("/p");
  const defaultIndex = `${HOME}/.claude/projects/${slug}/memory/MEMORY.md`;
  const memory = {
    [defaultIndex]: "- default",
    [`${HOME}/.claude/projects/${slug}/memory/topic.md`]: "topic",
    [`${HOME}/notes/MEMORY.md`]: "- custom",
    [`${HOME}/notes/other.md`]: "custom topic",
    "/mem/MEMORY.md": "- absolute",
  };
  const memoryPaths = (result: ResolvedContext) =>
    result.memory.filter((m) => m.kind === "memory-index" || m.kind === "memory-file").map((m) => m.path);

  it("loads nothing when autoMemoryEnabled is false", async () => {
    const result = await run({
      ...memory,
      "/p/.claude/settings.json": JSON.stringify({ autoMemoryEnabled: false }),
    });
    expect(memoryPaths(result)).toEqual([]);
    expect(result.effective.autoMemory).toMatchObject({ value: false });
  });

  it("reads autoMemoryDirectory, expanding ~/ to the home directory", async () => {
    const result = await run({
      ...memory,
      [`${HOME}/.claude/settings.json`]: JSON.stringify({ autoMemoryDirectory: "~/notes" }),
    });
    expect(memoryPaths(result)).toEqual([`${HOME}/notes/MEMORY.md`, `${HOME}/notes/other.md`]);
    expect(result.memory[0]).toMatchObject({ kind: "memory-index", layer: "user", loading: "always" });
  });

  it("lets a higher layer's absolute autoMemoryDirectory win", async () => {
    const result = await run({
      ...memory,
      [`${HOME}/.claude/settings.json`]: JSON.stringify({ autoMemoryDirectory: "~/notes" }),
      "/p/.claude/settings.local.json": JSON.stringify({ autoMemoryDirectory: "/mem" }),
    });
    expect(memoryPaths(result)).toEqual(["/mem/MEMORY.md"]);
  });

  it("ignores a relative autoMemoryDirectory", async () => {
    const result = await run({
      ...memory,
      "/p/.claude/settings.json": JSON.stringify({ autoMemoryDirectory: "notes" }),
    });
    expect(memoryPaths(result)).toEqual([defaultIndex, `${HOME}/.claude/projects/${slug}/memory/topic.md`]);
    expect(result.diagnostics.some((d) => d.includes("must be an absolute path"))).toBe(true);
  });

  it("loads none from a project-chosen directory while reads outside are blocked", async () => {
    const result = await run({
      ...memory,
      "/p/.claude/settings.json": JSON.stringify({ autoMemoryDirectory: "/mem" }),
      [`${HOME}/.claude/settings.json`]: JSON.stringify({
        permissions: { blockReadsOutsideWorkingDirectories: true },
      }),
    });
    expect(memoryPaths(result)).toEqual([]);
  });
});
