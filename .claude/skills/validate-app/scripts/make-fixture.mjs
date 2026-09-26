#!/usr/bin/env node
// Builds a throwaway project that exercises every config surface agentpov
// resolves, so validate-app has something rich to check. Build it outside any
// git repo (the scratchpad): it gets its own `git init`, so nothing above it
// leaks in.
//
// --nested builds an outer repo at <dest> with its own CLAUDE.md, rules,
// settings, skills and .mcp.json, and the kitchen-sink project inside it at
// <dest>/app with no .git of its own. Open <dest>/app: whatever of the outer
// repo Claude Code still picks up is what the app has to show for a project
// opened below its repo root.
//
// Every hook only appends its event name to .hooks.log in the folder Claude
// was started in, and every MCP server points at nothing, so running an agent
// here is harmless. Each file says in its own text what it is there to test.
//
// Usage: node make-fixture.mjs <dest> [--nested] [--force]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force");
const nested = args.includes("--nested");
const destArg = args.find((a) => !a.startsWith("--"));
if (!destArg) {
  console.error("usage: node make-fixture.mjs <dest> [--nested] [--force]");
  process.exit(1);
}
const root = resolve(destArg);
if (existsSync(root) && readdirSync(root).length > 0) {
  if (!force) {
    console.error(`${root} is not empty; pass --force to replace it`);
    process.exit(1);
  }
  rmSync(root, { recursive: true, force: true });
}
const dest = nested ? join(root, "app") : root;

const writeIn = (base) => (rel, body) => {
  const path = join(base, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body, null, 2) + "\n");
};
const write = writeIn(dest);
const md = (lines) => lines.join("\n") + "\n";
const skill = (name, description, extra = []) =>
  md(["---", `name: ${name}`, `description: ${description}`, ...extra, "---", "", `# ${name}`, "", description]);
const log = (event) => `echo ${event} >> "$CLAUDE_PROJECT_DIR/.hooks.log"`;

// Instructions: every location, an @import, rules with and without paths:,
// and a nested CLAUDE.md that only loads on read.
write("CLAUDE.md", md([
  "# kitchen-sink",
  "",
  "Fixture: project CLAUDE.md at the root. Always loaded.",
  "",
  "Conventions: @docs/conventions.md",
]));
write("docs/conventions.md", md(["Fixture: imported by the root CLAUDE.md."]));
write(".claude/CLAUDE.md", md(["Fixture: project CLAUDE.md inside .claude/. Always loaded."]));
write("CLAUDE.local.md", md(["Fixture: CLAUDE.local.md, the local layer. Always loaded."]));
write(".claude/rules/always.md", md(["Fixture: rule without paths:, always loaded."]));
write(".claude/rules/api.md", md([
  "---",
  "paths:",
  '  - "src/api/**"',
  "---",
  "Fixture: rule scoped to src/api/**, loads when a file there is read.",
]));
write("src/api/CLAUDE.md", md(["Fixture: nested CLAUDE.md in src/api, loads when a file there is read."]));
write("src/api/handler.ts", "// Fixture: target file. Reading it should pull in src/api/CLAUDE.md and the api rule.\nexport const handler = () => 'ok';\n");
write("src/web/page.ts", "// Fixture: target outside src/api. The api rule and src/api/CLAUDE.md should not load.\nexport const page = 1;\n");
write("src/legacy/CLAUDE.md", md(["Fixture: excluded by claudeMdExcludes in project settings, so it never loads."]));
write("src/legacy/old.ts", "// Fixture: target under src/legacy. Its CLAUDE.md is excluded.\nexport const old = 1;\n");
write("secrets/key.txt", "Fixture: Read of this file is denied by project settings.\n");
write("secrets/public.txt", "Fixture: denied by project settings, re-allowed by local settings.\n");

// Settings: permissions across project and local, every common hook event,
// and MCP approval keys.
write(".claude/settings.json", {
  permissions: {
    allow: ["Bash(npm test:*)", "Read(./src/**)"],
    ask: ["Edit(./src/api/**)"],
    deny: ["Read(./secrets/**)", "Bash(git push:*)", "Edit(./.env)"],
  },
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: log("SessionStart") }] }],
    UserPromptSubmit: [{ hooks: [{ type: "command", command: log("UserPromptSubmit") }] }],
    PreToolUse: [
      { matcher: "Read", hooks: [{ type: "command", command: log("PreToolUse:Read") }] },
      { matcher: "Edit|Write", hooks: [{ type: "command", command: log("PreToolUse:Edit|Write"), timeout: 5 }] },
    ],
    PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: log("PostToolUse:*") }] }],
    Stop: [{ hooks: [{ type: "command", command: log("Stop") }] }],
  },
  enabledMcpjsonServers: ["approved-stdio", "approved-http"],
  disabledMcpjsonServers: ["blocked"],
  claudeMdExcludes: ["**/src/legacy/CLAUDE.md"],
});
write(".claude/settings.local.json", {
  permissions: { allow: ["Read(./secrets/public.txt)"] },
  hooks: {
    PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: log("PostToolUse:Edit(local)") }] }],
  },
});

// MCP: approved, disabled and never-approved servers; none of them connect.
write(".mcp.json", {
  mcpServers: {
    "approved-stdio": { command: "node", args: ["-e", "process.exit(0)"], env: { FIXTURE: "1" } },
    "approved-http": { type: "http", url: "http://127.0.0.1:9/mcp", headers: { "X-Fixture": "1" } },
    blocked: { command: "node", args: ["-e", "process.exit(0)"] },
    pending: { type: "sse", url: "http://127.0.0.1:9/sse" },
  },
});

// Skills: project, model-only, nested under a subdirectory, symlinked.
write(".claude/skills/proj-skill/SKILL.md", skill("proj-skill", "Fixture: plain project skill."));
write(".claude/skills/display-name/SKILL.md", skill("Fancy Display Name", "Fixture: frontmatter name differs from the directory name."));
write(".claude/skills/model-only/SKILL.md", skill("model-only", "Fixture: user-invocable false, so only the model can use it.", ["user-invocable: false"]));
write("src/web/.claude/skills/web-skill/SKILL.md", skill("web-skill", "Fixture: nested skill under src/web, loads once Claude touches a file there."));
write("shared-skills/linked-skill/SKILL.md", skill("linked-skill", "Fixture: reached through a symlinked directory in .claude/skills."));
symlinkSync("../../shared-skills/linked-skill", join(dest, ".claude/skills/linked-skill"));

// Subagents and legacy commands.
write(".claude/agents/reviewer.md", md([
  "---",
  "name: reviewer",
  "description: Fixture subagent with most frontmatter fields set.",
  "tools: Read, Grep",
  "model: sonnet",
  "permissionMode: plan",
  "maxTurns: 5",
  "---",
  "Fixture: project subagent.",
]));
write(".claude/commands/legacy-cmd.md", md(["Fixture: legacy .claude/commands entry."]));
write(".claude/commands/tools/deep-cmd.md", md(["Fixture: command in a subfolder, named tools:deep-cmd."]));

write("FIXTURE.md", md([
  "# kitchen-sink fixture",
  "",
  "Generated by .claude/skills/validate-app/scripts/make-fixture.mjs.",
  "Good targets: the folder itself, src/api/handler.ts, src/web/page.ts, src/legacy/old.ts,",
  "secrets/key.txt (Read denied), secrets/public.txt (denied, then re-allowed locally).",
  "Hooks append their event name to .hooks.log.",
]));
write(".gitignore", ".hooks.log\n");

if (nested) {
  // The outer repo: one of each surface, so the diff shows which ones Claude
  // Code still reads when it starts in <root>/app.
  const outer = writeIn(root);
  outer("CLAUDE.md", md(["Fixture: outer repo CLAUDE.md, above the opened folder."]));
  outer("CLAUDE.local.md", md(["Fixture: outer repo CLAUDE.local.md, above the opened folder."]));
  outer(".claude/CLAUDE.md", md(["Fixture: outer repo .claude/CLAUDE.md, above the opened folder."]));
  outer(".claude/rules/outer-rule.md", md(["Fixture: outer repo rule, above the opened folder."]));
  outer(".claude/skills/outer-skill/SKILL.md", skill("outer-skill", "Fixture: outer repo skill, above the opened folder."));
  outer(".claude/agents/outer-agent.md", md(["---", "name: outer-agent", "description: Fixture: outer repo subagent.", "---", "Fixture."]));
  outer(".claude/settings.json", {
    permissions: { deny: ["Read(./app/secrets/**)", "Bash(rm:*)"] },
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: log("Outer:SessionStart") }] }] },
    enabledMcpjsonServers: ["outer-server"],
  });
  outer(".mcp.json", { mcpServers: { "outer-server": { type: "http", url: "http://127.0.0.1:9/outer" } } });
  outer(".gitignore", ".hooks.log\n**/.hooks.log\n");
  outer("FIXTURE.md", md([
    "# nested fixture",
    "",
    "Outer repo with the kitchen-sink project in app/. Open app/, not this folder.",
  ]));
}

execFileSync("git", ["init", "-q"], { cwd: root });
console.log(dest);
