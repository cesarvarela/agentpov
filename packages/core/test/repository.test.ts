import { describe, expect, it } from "vitest";

import { resolveContext, type ResolvedContext } from "../src/index.js";
import { projectSlug } from "../src/memory.js";
import { memfs } from "./memfs.js";

// Rules checked against Claude Code 2.1.280 by starting it in a folder below
// its repo root and in a linked worktree (see .claude/skills/validate-app).

const HOME = "/home/dev";
const skill = (name: string) => `---\nname: ${name}\ndescription: ${name}\n---\n`;
const agent = (name: string) => `---\nname: ${name}\n---\n`;
const mcp = (name: string) => JSON.stringify({ mcpServers: { [name]: { type: "http", url: "http://x" } } });

function run(files: Record<string, string>, folder: string, target = "."): Promise<ResolvedContext> {
  return resolveContext(folder, target, {
    fs: memfs(files),
    homeDir: HOME,
    platform: "linux",
    targetKind: target === "." ? "directory" : "file",
  });
}

/** One of each surface at `dir`, tagged so tests can tell the levels apart. */
function level(dir: string, tag: string): Record<string, string> {
  return {
    [`${dir}/CLAUDE.md`]: `${tag} CLAUDE.md`,
    [`${dir}/.claude/CLAUDE.md`]: `${tag} .claude/CLAUDE.md`,
    [`${dir}/.claude/rules/${tag}.md`]: `${tag} rule`,
    [`${dir}/CLAUDE.local.md`]: `${tag} CLAUDE.local.md`,
    [`${dir}/.claude/skills/${tag}-skill/SKILL.md`]: skill(`${tag}-skill`),
    [`${dir}/.claude/agents/${tag}-agent.md`]: agent(`${tag}-agent`),
    [`${dir}/.claude/commands/${tag}-cmd.md`]: `${tag} command`,
    [`${dir}/.mcp.json`]: mcp(`${tag}-server`),
    [`${dir}/.claude/settings.json`]: JSON.stringify({ env: { LEVEL: `${tag}-project` } }),
    [`${dir}/.claude/settings.local.json`]: JSON.stringify({ env: { LEVEL: `${tag}-local` } }),
  };
}

// /work (no git) > /work/repo (git root) > /work/repo/mid > /work/repo/mid/app (opened)
const nested = {
  ...level("/work", "top"),
  ...level("/work/repo", "repo"),
  "/work/repo/.git/HEAD": "ref: refs/heads/main",
  ...level("/work/repo/mid", "mid"),
  ...level("/work/repo/mid/app", "app"),
};

describe("a project opened below its repository root", () => {
  it("loads instruction files from every parent folder, past the git root", async () => {
    const { memory } = await run(nested, "/work/repo/mid/app");
    const paths = memory.map((m) => m.path);
    expect(paths).toEqual([
      "/work/CLAUDE.md",
      "/work/.claude/CLAUDE.md",
      "/work/.claude/rules/top.md",
      "/work/CLAUDE.local.md",
      "/work/repo/CLAUDE.md",
      "/work/repo/.claude/CLAUDE.md",
      "/work/repo/.claude/rules/repo.md",
      "/work/repo/CLAUDE.local.md",
      "/work/repo/mid/CLAUDE.md",
      "/work/repo/mid/.claude/CLAUDE.md",
      "/work/repo/mid/.claude/rules/mid.md",
      "/work/repo/mid/CLAUDE.local.md",
      "/work/repo/mid/app/CLAUDE.md",
      "/work/repo/mid/app/.claude/CLAUDE.md",
      "/work/repo/mid/app/CLAUDE.local.md",
      "/work/repo/mid/app/.claude/rules/app.md",
    ]);
    expect(memory.every((m) => m.loading === "always")).toBe(true);
  });

  it("reads path-scoped rules in a parent folder relative to that folder", async () => {
    const files = {
      "/work/repo/.git/HEAD": "",
      "/work/repo/.claude/rules/api.md": '---\npaths:\n  - "app/src/**"\n---\napi',
      "/work/repo/app/src/x.ts": "",
    };
    const hit = await run(files, "/work/repo/app", "src/x.ts");
    expect(hit.memory.map((m) => m.path)).toContain("/work/repo/.claude/rules/api.md");
  });

  it("takes skills, subagents and commands from folders up to the git root only", async () => {
    const result = await run(nested, "/work/repo/mid/app");
    const project = (list: { layer: string; name: string }[]) =>
      list.filter((e) => e.layer === "project").map((e) => e.name).sort();

    expect(project(result.skills)).toEqual([
      "app-cmd", "app-skill", "mid-cmd", "mid-skill", "repo-cmd", "repo-skill",
    ]);
    expect(project(result.agents)).toEqual(["app-agent", "mid-agent", "repo-agent"]);
    expect(result.skills.find((s) => s.name === "app-cmd")?.source).toBe("command");
  });

  it("takes .mcp.json servers from every parent folder, past the git root", async () => {
    const { mcpServers } = await run(nested, "/work/repo/mid/app");
    expect(mcpServers.map((m) => m.name).sort()).toEqual([
      "app-server", "mid-server", "repo-server", "top-server",
    ]);
  });

  it("reads project settings from the folder, local settings from it and the repo root", async () => {
    const { settings } = await run(nested, "/work/repo/mid/app");
    expect(settings.map((s) => [s.path, s.layer])).toEqual([
      ["/work/repo/mid/app/.claude/settings.json", "project"],
      ["/work/repo/.claude/settings.local.json", "local"],
      ["/work/repo/mid/app/.claude/settings.local.json", "local"],
    ]);
  });

  it("stays inside the folder when there is no repository", async () => {
    const files = { ...level("/work", "top"), ...level("/work/app", "app") };
    const result = await run(files, "/work/app");
    expect(result.skills.filter((s) => s.layer === "project").map((s) => s.name).sort()).toEqual([
      "app-cmd", "app-skill",
    ]);
    expect(result.settings.map((s) => s.path)).toEqual([
      "/work/app/.claude/settings.json",
      "/work/app/.claude/settings.local.json",
    ]);
    // Instruction files and .mcp.json still come from parent folders.
    expect(result.memory.map((m) => m.path)).toContain("/work/CLAUDE.md");
    expect(result.mcpServers.map((m) => m.name)).toContain("top-server");
  });
});

describe("a linked worktree", () => {
  const files = {
    "/code/main/.git/HEAD": "ref: refs/heads/main",
    "/code/main/.git/worktrees/wt/commondir": "../..\n",
    "/code/main/.claude/settings.local.json": JSON.stringify({ env: { FROM: "main" } }),
    "/code/wt/.git": "gitdir: /code/main/.git/worktrees/wt\n",
    "/code/wt/.claude/skills/wt-skill/SKILL.md": skill("wt-skill"),
    "/code/main/.claude/skills/main-skill/SKILL.md": skill("main-skill"),
    [`${HOME}/.claude/projects/-code-main/memory/MEMORY.md`]: "- shared memory",
  };

  it("uses the main checkout's memory and local settings", async () => {
    const result = await run(files, "/code/wt");
    expect(result.memory.map((m) => m.path)).toEqual([
      `${HOME}/.claude/projects/-code-main/memory/MEMORY.md`,
    ]);
    expect(result.settings.map((s) => s.path)).toEqual(["/code/main/.claude/settings.local.json"]);
  });

  it("takes skills from the worktree, not the main checkout", async () => {
    const result = await run(files, "/code/wt");
    expect(result.skills.map((s) => s.name)).toEqual(["wt-skill"]);
  });
});

describe("a worktree kept inside its main checkout", () => {
  it("skips the checkout's checked-in instructions but keeps its CLAUDE.local.md", async () => {
    const wt = "/code/main/.claude/worktrees/wt";
    const files = {
      ...level("/code", "top"),
      ...level("/code/main", "main"),
      "/code/main/.git/HEAD": "",
      "/code/main/.git/worktrees/wt/commondir": "../..",
      [`${wt}/.git`]: "gitdir: /code/main/.git/worktrees/wt",
      [`${wt}/CLAUDE.md`]: "worktree copy",
    };
    const { memory } = await run(files, wt);
    expect(memory.map((m) => m.path)).toEqual([
      "/code/CLAUDE.md",
      "/code/.claude/CLAUDE.md",
      "/code/.claude/rules/top.md",
      "/code/CLAUDE.local.md",
      "/code/main/CLAUDE.local.md",
      `${wt}/CLAUDE.md`,
    ]);
  });
});

describe("legacy commands", () => {
  it("are named after their file, prefixed by subfolders", async () => {
    const files = {
      "/p/.claude/commands/flat.md": "x",
      "/p/.claude/commands/sub/deep.md": "---\ndescription: deep one\n---\n",
      "/p/.claude/commands/sub/deeper/deepest.md": "x",
      [`${HOME}/.claude/commands/mine.md`]: "x",
    };
    const { skills } = await run(files, "/p");
    expect(skills.map((s) => [s.name, s.layer, s.source])).toEqual([
      ["mine", "user", "command"],
      ["flat", "project", "command"],
      ["sub:deep", "project", "command"],
      ["sub:deeper:deepest", "project", "command"],
    ]);
    expect(skills.find((s) => s.name === "sub:deep")?.description).toBe("deep one");
  });
});

describe("claudeMdExcludes", () => {
  it("drops matching CLAUDE.md and rule files, along with their imports", async () => {
    const files = {
      "/p/.git/HEAD": "",
      "/p/CLAUDE.md": "root @docs/a.md",
      "/p/docs/a.md": "imported",
      "/p/.claude/rules/keep.md": "keep",
      "/p/.claude/rules/legacy/old.md": "old",
      "/p/.claude/settings.json": JSON.stringify({
        claudeMdExcludes: ["/p/CLAUDE.md", "**/rules/legacy/**"],
      }),
    };
    const { memory } = await run(files, "/p");
    expect(memory.map((m) => m.path)).toEqual(["/p/.claude/rules/keep.md"]);
  });

  it("never drops managed files", async () => {
    const files = {
      "/etc/claude-code/CLAUDE.md": "policy",
      "/p/.claude/settings.json": JSON.stringify({ claudeMdExcludes: ["**/CLAUDE.md"] }),
    };
    const { memory } = await run(files, "/p");
    expect(memory.map((m) => m.path)).toEqual(["/etc/claude-code/CLAUDE.md"]);
  });
});

describe("plugins kept in ~/.claude/skills", () => {
  it("loads the plugin's skills namespaced, and its own SKILL.md as a personal skill", async () => {
    const dir = `${HOME}/.claude/skills/pz`;
    const files = {
      [`${dir}/SKILL.md`]: skill("pz"),
      [`${dir}/.claude-plugin/plugin.json`]: JSON.stringify({ name: "pz", skills: ["./extra"] }),
      [`${dir}/skills/pz/SKILL.md`]: skill("pz"),
      [`${dir}/extra/more/SKILL.md`]: skill("more"),
    };
    const { skills } = await run(files, "/p");
    expect(skills.map((s) => [s.name, s.source])).toEqual([
      ["pz", "personal"],
      ["pz:pz", "plugin"],
      ["pz:more", "plugin"],
    ]);
  });

  it("skips one turned off in enabledPlugins", async () => {
    const dir = `${HOME}/.claude/skills/pz`;
    const files = {
      [`${dir}/.claude-plugin/plugin.json`]: JSON.stringify({ name: "pz" }),
      [`${dir}/skills/pz/SKILL.md`]: skill("pz"),
      [`${HOME}/.claude/settings.json`]: JSON.stringify({ enabledPlugins: { "pz@skills-dir": false } }),
    };
    const { skills } = await run(files, "/p");
    expect(skills).toEqual([]);
  });
});

describe("projectSlug", () => {
  it("turns every non-alphanumeric character into a dash", () => {
    expect(projectSlug("/tmp/my.proj_x y+z")).toBe("-tmp-my-proj-x-y-z");
  });
});
