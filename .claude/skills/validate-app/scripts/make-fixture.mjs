#!/usr/bin/env node
// Builds a throwaway project that exercises every config surface agentpov
// resolves, so validate-app has something rich to check. Build it outside the
// repo (the scratchpad) — inside, its CLAUDE.md and skills would show up in
// agentpov's own view.
//
// Every hook only appends its event name to <dest>/.hooks.log, and every MCP
// server points at nothing, so running an agent here is harmless. Each file
// says in its own text what it is there to test.
//
// Usage: node make-fixture.mjs <dest> [--force]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force");
const destArg = args.find((a) => a !== "--force");
if (!destArg) {
  console.error("usage: node make-fixture.mjs <dest> [--force]");
  process.exit(1);
}
const dest = resolve(destArg);
if (existsSync(dest) && readdirSync(dest).length > 0) {
  if (!force) {
    console.error(`${dest} is not empty; pass --force to replace it`);
    process.exit(1);
  }
  rmSync(dest, { recursive: true, force: true });
}

const write = (rel, body) => {
  const path = join(dest, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body, null, 2) + "\n");
};
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
write(".claude/commands/legacy-cmd.md", md(["Fixture: legacy .claude/commands entry, now loaded as a skill."]));

write("FIXTURE.md", md([
  "# kitchen-sink fixture",
  "",
  "Generated by .claude/skills/validate-app/scripts/make-fixture.mjs.",
  "Good targets: the folder itself, src/api/handler.ts, src/web/page.ts,",
  "secrets/key.txt (Read denied), secrets/public.txt (denied, then re-allowed locally).",
  "Hooks append their event name to .hooks.log.",
]));
write(".gitignore", ".hooks.log\n");

execFileSync("git", ["init", "-q"], { cwd: dest });
console.log(dest);
