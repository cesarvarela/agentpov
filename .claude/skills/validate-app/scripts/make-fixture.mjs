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
// --agents-md builds a project with no CLAUDE.md at all, only AGENTS.md files,
// which Claude Code 2.1.277+ reads in their place.
//
// --config <dir> also builds an isolated Claude Code user config at <dir>, to
// pass as CLAUDE_CONFIG_DIR (adapter and app-view take --config-dir <dir>):
// a local marketplace with one installed plugin that ships every component
// kind, a user skills-dir plugin, and user settings. It runs `claude plugin`
// with CLAUDE_CONFIG_DIR=<dir>, so the real ~/.claude is never touched.
//
// Usage: node make-fixture.mjs <dest> [--nested | --agents-md] [--config <dir>] [--force]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force");
const nested = args.includes("--nested");
const agentsMd = args.includes("--agents-md");
const configAt = args.indexOf("--config");
const configArg = configAt >= 0 ? args[configAt + 1] : undefined;
const destArg = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--config");
if (!destArg || (configAt >= 0 && !configArg)) {
  console.error("usage: node make-fixture.mjs <dest> [--nested | --agents-md] [--config <dir>] [--force]");
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

if (agentsMd) {
  // Instructions only in AGENTS.md: Claude Code reads them because there is
  // no CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md here or above.
  write("AGENTS.md", md(["# agents-md", "", "Fixture: root AGENTS.md, read in place of a CLAUDE.md.", "", "Shared: @docs/shared.md"]));
  write("docs/shared.md", md(["Fixture: imported by the root AGENTS.md."]));
  write(".claude/AGENTS.md", md(["Fixture: .claude/AGENTS.md, also read at start."]));
  write(".claude/rules/always.md", md(["Fixture: rule, loads alongside AGENTS.md."]));
  write("AGENTS.override.md", md(["Fixture: Codex-only override. Claude Code never reads it."]));
  write("AGENTS.local.md", md(["Fixture: not read by Claude Code."]));
  write(".agents/AGENTS.md", md(["Fixture: under .agents/, not read by Claude Code."]));
  write("pkg/AGENTS.md", md(["Fixture: pkg/AGENTS.md, loads when a file in pkg/ is read."]));
  write("pkg/index.ts", "// Fixture: target. Reading it should pull in pkg/AGENTS.md.\nexport const x = 1;\n");
  write("mixed/CLAUDE.md", md(["Fixture: mixed/ has its own CLAUDE.md, so its AGENTS.md stays out."]));
  write("mixed/AGENTS.md", md(["Fixture: shadowed by mixed/CLAUDE.md on read."]));
  write("mixed/index.ts", "// Fixture: target. mixed/CLAUDE.md loads, mixed/AGENTS.md doesn't.\nexport const y = 1;\n");
  write("FIXTURE.md", md([
    "# agents-md fixture",
    "",
    "Targets: the folder, pkg/index.ts, mixed/index.ts.",
  ]));
  execFileSync("git", ["init", "-q"], { cwd: root });
  if (configArg) buildConfig(resolve(configArg));
  console.log(dest);
  process.exit(0);
}

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
  enabledMcpjsonServers: ["approved-stdio", "approved-http", "denied-by-policy"],
  disabledMcpjsonServers: ["blocked"],
  // Approved above, but the denylist wins.
  deniedMcpServers: [{ serverName: "denied-by-policy" }],
  claudeMdExcludes: ["**/src/legacy/CLAUDE.md"],
  // Only Bash is sandboxed; the app shows what sandboxed Bash can do to the target.
  sandbox: {
    enabled: true,
    filesystem: { denyWrite: ["./src/legacy"], denyRead: ["./secrets/key.txt"] },
    network: { allowedDomains: ["example.com"] },
  },
});
write(".claude/settings.local.json", {
  permissions: { allow: ["Read(./secrets/public.txt)"] },
  outputStyle: "Terse",
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
    "denied-by-policy": { command: "node", args: ["-e", "process.exit(0)"] },
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

// Frontmatter hooks: a skill's run once it is invoked, a subagent's only while
// it runs (its Stop registers as SubagentStop).
write(".claude/skills/hooked/SKILL.md", md([
  "---",
  "name: hooked",
  "description: Fixture skill that declares its own hooks.",
  "hooks:",
  "  PostToolUse:",
  "    - matcher: Edit|Write",
  "      hooks:",
  "        - type: command",
  `          command: ${log("Skill:PostToolUse")}`,
  "---",
  "Fixture.",
]));
write(".claude/agents/hooked-agent.md", md([
  "---",
  "name: hooked-agent",
  "description: Fixture subagent with frontmatter hooks.",
  "hooks:",
  "  Stop:",
  "    - hooks:",
  "        - type: command",
  `          command: ${log("Agent:Stop")}`,
  "---",
  "Fixture.",
]));

// Output styles and workflows.
write(".claude/output-styles/terse.md", md([
  "---",
  "name: Terse",
  "description: Fixture output style, selected in local settings.",
  "keep-coding-instructions: true",
  "---",
  "Answer in as few words as possible.",
]));
write(".claude/workflows/release.js", [
  "export const meta = { name: 'release', description: 'Fixture workflow.' }",
  "await agent('noop')",
  "",
].join("\n"));

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
if (configArg) buildConfig(resolve(configArg));
console.log(dest);

/**
 * An isolated CLAUDE_CONFIG_DIR: user settings, a user skills-dir plugin, and
 * a local marketplace whose one plugin ships skills, commands, agents, hooks,
 * MCP servers, output styles and workflows, installed with the real CLI.
 */
function buildConfig(config) {
  if (existsSync(config)) {
    if (!force) {
      console.error(`${config} exists; pass --force to replace it`);
      process.exit(1);
    }
    rmSync(config, { recursive: true, force: true });
  }
  const market = `${config}-marketplace`;
  rmSync(market, { recursive: true, force: true });
  const inMarket = writeIn(market);
  inMarket(".claude-plugin/marketplace.json", {
    name: "fixture-mkt",
    owner: { name: "fixture" },
    plugins: [
      { name: "kit", source: "./plugins/kit", description: "Fixture plugin with every component." },
      { name: "off-kit", source: "./plugins/off-kit", description: "Fixture plugin, installed then disabled." },
    ],
  });
  const kit = writeIn(join(market, "plugins/kit"));
  kit(".claude-plugin/plugin.json", { name: "kit", version: "1.0.0", description: "Fixture plugin." });
  kit("skills/kit-skill/SKILL.md", skill("kit-skill", "Fixture: plugin skill."));
  kit("commands/kit-cmd.md", md(["Fixture: plugin command."]));
  kit("agents/kit-agent.md", md(["---", "name: kit-agent", "description: Fixture: plugin subagent.", "---", "Fixture."]));
  kit("agents/team/deep-agent.md", md(["---", "name: deep-agent", "description: Fixture: plugin subagent in a subfolder.", "---", "Fixture."]));
  kit("hooks/hooks.json", {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: "echo Plugin:SessionStart >> \"${CLAUDE_PLUGIN_ROOT}/.hooks.log\"" }] }],
    },
  });
  kit(".mcp.json", { mcpServers: { "kit-server": { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/never.js"] } } });
  kit("output-styles/kit-style.md", md(["---", "name: kit-style", "description: Fixture: plugin output style.", "---", "Fixture."]));
  kit("workflows/kit-flow.js", "export const meta = { name: 'kit-flow', description: 'Fixture plugin workflow.' }\n");
  const offKit = writeIn(join(market, "plugins/off-kit"));
  offKit(".claude-plugin/plugin.json", { name: "off-kit", version: "1.0.0" });
  offKit("skills/off-skill/SKILL.md", skill("off-skill", "Fixture: from a disabled plugin, never loads."));

  const env = { ...process.env, CLAUDE_CONFIG_DIR: config };
  const cli = (...cliArgs) => execFileSync("claude", cliArgs, { env, stdio: "pipe" });
  mkdirSync(config, { recursive: true });
  cli("plugin", "marketplace", "add", market);
  cli("plugin", "install", "kit@fixture-mkt", "--scope", "user");
  cli("plugin", "install", "off-kit@fixture-mkt", "--scope", "user");
  cli("plugin", "disable", "off-kit@fixture-mkt", "--scope", "user");

  const user = writeIn(config);
  user("skills/user-skill/SKILL.md", skill("user-skill", "Fixture: personal skill in the isolated config."));
  user("skills/user-kit/.claude-plugin/plugin.json", { name: "user-kit", version: "0.1.0" });
  user("skills/user-kit/skills/ukit-skill/SKILL.md", skill("ukit-skill", "Fixture: skill from a user skills-dir plugin."));
  user("agents/user-agent.md", md(["---", "name: user-agent", "description: Fixture: user subagent.", "---", "Fixture."]));
  user("CLAUDE.md", md(["Fixture: user CLAUDE.md in the isolated config."]));
  user("output-styles/user-style.md", md(["---", "name: user-style", "description: Fixture: user output style.", "---", "Fixture."]));
  user("workflows/user-flow.js", "export const meta = { name: 'user-flow', description: 'Fixture user workflow.' }\n");
}
