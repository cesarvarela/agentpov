#!/usr/bin/env node
// Mechanical diff of app-view.mjs output against an agent adapter's view.
// Prints, per category, what only the app shows, what only the agent has,
// and what both agree on. A category the adapter reports as null is one that
// agent can't tell us about, so it is skipped rather than diffed. Rows matched
// by agents/<agent>/ignore.json are counted, not listed. Deciding whether a
// remaining difference is a bug is the caller's job.
//
// Usage: node compare.mjs <app.json> <agent-view.json>

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [appPath, viewPath] = process.argv.slice(2);
if (!appPath || !viewPath) {
  console.error("usage: node compare.mjs <app.json> <agent-view.json>");
  process.exit(1);
}
const app = JSON.parse(readFileSync(appPath, "utf8"));
const view = JSON.parse(readFileSync(viewPath, "utf8"));
const agent = view.agent ?? "agent";

const ignorePath = resolve(dirname(fileURLToPath(import.meta.url)), "../agents", agent, "ignore.json");
const ignoreFile = existsSync(ignorePath) ? JSON.parse(readFileSync(ignorePath, "utf8")) : { ignore: [] };

/** The ignore entry covering `name` on `side` of `category`, if any. */
function ignoredBy(category, side, name) {
  return ignoreFile.ignore.find(
    (rule) =>
      rule.category === category &&
      rule.side === side &&
      ((rule.names ?? []).includes(name) || (rule.pattern && new RegExp(rule.pattern).test(name))),
  );
}

function listRows(label, rows, category, side) {
  const kept = rows.filter((x) => !ignoredBy(category, side, x));
  const ignored = rows.length - kept.length;
  const suffix = ignored ? ` (+${ignored} ignored)` : "";
  console.log(`${label} (${kept.length})${suffix}:${kept.map((x) => `\n  - ${x}`).join("") || " -"}`);
}

function section(title, appItems, agentItems, note, category) {
  console.log(`\n## ${title}`);
  if (agentItems == null) {
    console.log(`skipped: the ${agent} adapter can't report this`);
    return;
  }
  if (note) console.log(note);
  const a = new Set(appItems);
  const c = new Set(agentItems);
  const onlyApp = [...a].filter((x) => !c.has(x)).sort();
  const onlyAgent = [...c].filter((x) => !a.has(x)).sort();
  const both = [...a].filter((x) => c.has(x)).sort();
  console.log(`both (${both.length}): ${both.join(", ") || "-"}`);
  listRows("ONLY APP", onlyApp, category, "app");
  listRows(`ONLY ${agent.toUpperCase()}`, onlyAgent, category, "agent");
}

console.log(`# app vs ${agent} ${view.version ?? "?"}`);
console.log(`folder: ${app.folder}\ntarget: ${app.target} (${app.targetKind})`);
if (ignoreFile.validatedVersion && view.version && ignoreFile.validatedVersion !== view.version) {
  console.log(`NOTE: ignore.json was validated against ${ignoreFile.validatedVersion}; run the changelog sweep.`);
}

section(
  "Instructions and memory in context at start",
  app.memory.filter((m) => m.loading === "always" && m.kind !== "memory-file").map((m) => m.path),
  view.instructions?.start,
  "app: loading=always, excluding memory-file (recalled on demand).",
  "instructions",
);

if (app.targetKind === "file") {
  section(
    "Instructions attached after reading the target",
    app.memory.filter((m) => m.loading === "on-read").map((m) => m.path),
    view.instructions?.afterRead,
    "app: loading=on-read.",
    "instructions",
  );
}

const skillId = (s) => (s.source === "personal" || s.source === "project" ? s.shortName : s.name);
section("Skills", app.skills.filter((s) => !s.shadowedBy).map(skillId), view.skills, null, "skills");

section("Subagents", app.agents.filter((a) => !a.shadowedBy).map((a) => a.name), view.agents, null, "agents");

section(
  "MCP servers (enabled)",
  app.mcpServers.filter((m) => m.state === "enabled").map((m) => m.name),
  view.mcpServers?.map((m) => m.name),
  view.mcpServers &&
    `${agent} status/source: ${view.mcpServers.map((m) => `${m.name}=${m.status ?? "?"}/${m.source ?? "?"}`).join(", ") || "-"}\n` +
      `app non-enabled: ${app.mcpServers.filter((m) => m.state !== "enabled").map((m) => `${m.name}=${m.state}`).join(", ") || "-"}`,
  "mcpServers",
);

if (view.plugins) {
  console.log(`\n## Plugins (${agent} only; compare to app plugin skills)`);
  const plugins = view.plugins.filter((p) => !ignoredBy("plugins", "agent", p.source ?? p.name));
  for (const p of plugins) console.log(`  - ${p.name} ${p.source ?? ""} ${p.path ?? ""}`);
  if (plugins.length < view.plugins.length) console.log(`  (+${view.plugins.length - plugins.length} ignored)`);
}

console.log("\n## Read permission on target");
if (view.read == null) console.log(`skipped: no file target, or the ${agent} adapter can't report this`);
else {
  const denies = app.permissions.filter((r) => r.tool === "Read" && r.decision === "deny" && r.matchesFile && !r.overridden);
  console.log(`app: ${denies.length ? `denied by ${denies.map((r) => `${r.rule} (${r.layer})`).join(", ")}` : "no matching Read deny"}`);
  console.log(`${agent}: ${view.read}`);
}

console.log("\n## Hooks");
console.log(`app (${app.hooks.length}): ${app.hooks.map((h) => `${h.event}${h.matcher ? `[${h.matcher}]` : ""} ${h.layer}`).join("; ") || "-"}`);
if (view.hooks == null) console.log(`${agent}: skipped, adapter can't report hooks`);
else console.log(`${agent} events seen (${view.hooks.length}): ${view.hooks.map((h) => `${h.subtype ?? ""}:${h.event ?? "?"}`).join("; ") || "-"}`);
const hookDebug = (view.debug ?? []).filter((l) => /hooks? (from|in registry)/i.test(l));
if (hookDebug.length) console.log(`${agent} debug: ${hookDebug.join(" | ")}`);

console.log("\n## Settings files");
console.log(`app read: ${app.settings.map((s) => `${s.path} (${s.layer})`).join(", ") || "-"}`);
const settingsDebug = (view.debug ?? []).filter((l) => /settings/i.test(l));
if (settingsDebug.length) {
  console.log(`${agent} debug lines about settings:`);
  for (const l of settingsDebug) console.log(`  ${l}`);
}

if (app.diagnostics.length) {
  console.log("\n## App diagnostics");
  for (const d of app.diagnostics) console.log(`  - ${d}`);
}

if (ignoreFile.reminders?.length) {
  console.log("\n## Reminders from ignore.json");
  for (const r of ignoreFile.reminders) console.log(`  - ${r}`);
}
