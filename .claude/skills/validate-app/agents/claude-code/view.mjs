#!/usr/bin/env node
// Claude Code adapter: what Claude Code actually sees. Runs a headless
// `claude -p` session in <folder>, reads <target> when it is a file, and
// prints the common view format (see ../../SKILL.md, "Adapter contract").
//
// Sources, most to least exact:
//   stream-json init event   skills, subagents, MCP servers, plugins, version
//   --debug-file log         settings files, skill/agent dirs, plugins, hooks
//   the model's self-report  instruction files in context, before/after Read
//
// Usage: node view.mjs <folder> [target] [--model sonnet]
//
// The session runs with only the Read tool and dontAsk permissions, so it
// cannot edit anything, but the folder's own hooks (SessionStart, PreToolUse,
// ...) do run.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const modelAt = args.indexOf("--model");
const model = modelAt >= 0 ? args[modelAt + 1] : "sonnet";
const positional = args.filter((_, i) => modelAt < 0 || (i !== modelAt && i !== modelAt + 1));
const [folderArg, targetArg] = positional;
if (!folderArg) {
  console.error("usage: node view.mjs <folder> [target] [--model sonnet]");
  process.exit(1);
}
const folder = resolve(folderArg);
const target = targetArg ? resolve(folder, targetArg) : null;
const isFile = target !== null && statSync(target).isFile();

const readStep = isFile
  ? `Step 2: call the Read tool once on ${target}. ` +
    `Step 3: list the absolute path of every instruction or memory file that was attached to your context because of that read ` +
    `(for example a nested CLAUDE.md or a .claude/rules file), one per line prefixed "READ ", or the single line "READ none".`
  : "";
const prompt =
  "This is an audit. Answer only from your own context; do not guess or explore. " +
  "Step 1: list the absolute path of every instruction or memory file whose contents appear in your context right now " +
  '(CLAUDE.md files, .claude/rules files, @imported files, MEMORY.md, other memory files — e.g. "Contents of <path>" headers), ' +
  'one per line prefixed "START ". Write paths exactly as they appear. ' +
  readStep +
  " Output only those lines.";

const scratch = mkdtempSync(join(tmpdir(), "claude-view-"));
const debugFile = join(scratch, "debug.log");
const run = spawnSync(
  "claude",
  [
    "-p", prompt,
    "--model", model,
    "--tools", "Read",
    "--permission-mode", "dontAsk",
    "--no-session-persistence",
    "--include-hook-events",
    "--output-format", "stream-json",
    "--verbose",
    "--max-turns", "4",
    "--debug-file", debugFile,
  ],
  { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
);
if (run.status !== 0) {
  console.error(run.error ?? run.signal ?? "", run.stderr || run.stdout);
  process.exit(run.status ?? 1);
}

let init = null;
const text = [];
const hooks = [];
let read = isFile ? "not-attempted" : null;
for (const line of run.stdout.split("\n")) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    continue;
  }
  if (event.type === "system" && event.subtype === "init") init = event;
  else if (event.type === "system" && /hook/i.test(event.subtype ?? "")) hooks.push(event);
  else if (event.type === "assistant") {
    for (const block of event.message?.content ?? []) {
      if (block.type === "text") text.push(block.text);
    }
  } else if (event.type === "user") {
    for (const block of event.message?.content ?? []) {
      if (block.type !== "tool_result") continue;
      const body = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
      read = block.is_error ? `denied or failed: ${body.slice(0, 300)}` : "allowed";
    }
  }
}

const lines = text.join("\n").split("\n").map((l) => l.trim());
const listed = (prefix) =>
  lines
    .filter((l) => l.startsWith(prefix))
    .map((l) => l.slice(prefix.length).trim())
    .filter((l) => l && l !== "none");

const debug = [];
try {
  const seen = new Set();
  for (const raw of readFileSync(debugFile, "utf8").split("\n")) {
    const l = raw.replace(/^\S+ /, "");
    if (!/settings|skill|hook|plugin|mcp|agent|claude\.md|memory|rules|permission/i.test(l)) continue;
    if (/telemetry|attribution|fast mode|mTLS|API:timing/i.test(l)) continue;
    if (!seen.has(l)) seen.add(l), debug.push(l);
  }
} catch {}
rmSync(scratch, { recursive: true, force: true });

console.log(
  JSON.stringify(
    {
      agent: "claude-code",
      version: init?.claude_code_version ?? null,
      folder,
      target,
      instructions: { start: listed("START "), afterRead: isFile ? listed("READ ") : null },
      skills: init?.skills ?? null,
      // Everything invocable that isn't a skill: legacy .claude/commands plus
      // the CLI's built-in commands (ignore.json lists those).
      commands: init ? init.slash_commands.filter((c) => !init.skills.includes(c)) : null,
      agents: init?.agents ?? null,
      mcpServers: (init?.mcp_servers ?? []).map((m) => ({ name: m.name, status: m.status, source: m.source })),
      plugins: (init?.plugins ?? []).map((p) => ({ name: p.name, source: p.source, path: p.path })),
      read,
      hooks: hooks.map((h) => ({ subtype: h.subtype, event: h.hook_event ?? h.hook_event_name, name: h.hook_name })),
      debug: debug.slice(0, 200),
      extra: init && {
        memory_paths: init.memory_paths,
        permissionMode: init.permissionMode,
        model: init.model,
        slash_commands: init.slash_commands,
      },
    },
    null,
    2,
  ),
);
