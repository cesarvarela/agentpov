---
name: validate-app
description: Check that what agentpov shows for a folder or file matches what a coding agent (Claude Code today) actually loads there, and flag anything wrong, missing, or new. Runs the app's resolver and a headless agent session side by side, diffs them, triages every difference against the real files and the docs, and sweeps the agent's changelog for config surfaces the app doesn't model yet. Use when asked to validate, verify, audit, or sanity-check the app's output, compare it with Claude Code or another agent, or find what the resolver gets wrong or is missing.
argument-hint: "[--agent claude-code] [folder] [target-file-or-dir]"
---

# Validate agentpov against the real agent

agentpov claims to show what a coding agent sees. This skill checks that
claim against the agent itself — a headless session in the same folder — and
reports every disagreement as **WRONG**, **MISSING** or **NEW**.

The scripts only line the two views up. The judgment — which side is right,
and why — is yours, and every finding needs evidence from disk, the agent, or
its docs.

## Inputs

- `--agent`: an `id` from `AGENTS` in `packages/ui/src/agents.tsx`. Default
  `claude-code`.
- `folder`: project to check. Default: the repo root of this checkout.
- `target`: file or directory inside it — what you'd select in the app's
  file tree. Default: the folder itself.

One target proves little. For a full check, build the fixture — a throwaway
project with every surface the app resolves, harmless hooks and dead MCP
servers — and run its targets (listed in its `FIXTURE.md`):

```bash
node .claude/skills/validate-app/scripts/make-fixture.mjs <scratchpad>/kitchen-sink --force
```

For a real project, unless the user named a target, run at least:

1. the folder itself (directory target), and
2. a file in a subdirectory that has its own instruction file, rules with
   path globs, or skills — whatever exists; `find` for them.

If the user has other real projects with rich config (hooks, MCP servers,
rules, subagents), ask whether to include one — they catch far more than
this repo does.

## Layout

```
scripts/app-view.mjs     what the app shows (shared)
scripts/compare.mjs      diffs the app against any adapter's view (shared)
scripts/make-fixture.mjs builds a project that exercises every surface (shared)
agents/<id>/view.mjs     runs the agent headless, prints the common view
agents/<id>/notes.md     how the adapter works, what to trust, docs, limits
agents/<id>/ignore.json   accepted differences + last version validated
```

## Before you start

1. Check `AGENTS` in `packages/ui/src/agents.tsx`. If the agent is not
   `supported: true`, stop: the app doesn't resolve it, so there's nothing
   to validate. Say so.
2. If `agents/<id>/` doesn't exist for a supported agent, the adapter is
   missing. Offer to write one per **Adapter contract** below, then continue.
3. Read `agents/<id>/notes.md` and `agents/<id>/ignore.json`.

## Steps

Work in the scratchpad directory. `S` below is that path; `V` is
`.claude/skills/validate-app`.

### 1. Build core

The app view loads `packages/core/dist`, so it must match `src`:

```bash
pnpm -F @agentpov/core build
```

### 2. Collect both views

```bash
node $V/scripts/app-view.mjs <folder> [target] [--dir] > $S/app.json
node $V/agents/<id>/view.mjs <folder> [target] > $S/agent.json
node $V/scripts/compare.mjs $S/app.json $S/agent.json
```

- `app-view` makes the same `resolveContext` call the desktop main process
  makes. Pass `--dir` when the target is a directory.
- The adapter runs the real agent. `notes.md` says which fields are exact and
  which are the model's self-report, and what side effects running it has —
  heed them before running on a folder you haven't seen.
- `compare` prints ONLY APP / ONLY <AGENT> / both per category, and skips
  categories the adapter reports as `null`.

Keep `agent.json`'s `debug` array open: it shows which files and dirs the
agent actually looked at — the fastest way to see *why* something is missing.

### 3. Triage every difference

For each ONLY row, find the cause before labelling it. Look at the real file
(frontmatter, symlink vs directory, settings key), the debug log, and
`packages/core/src` for how the app treats it.

| Label | Meaning |
|---|---|
| **WRONG** | The app shows it, but the agent doesn't load it — or loads it differently (layer, state, loading mode, shadowing, permission verdict). |
| **MISSING** | The agent loads it from a surface the app already models, but the app doesn't show it. |
| **NEW** | The agent loads it from a surface the app doesn't model at all (a new config location, plugin kind, connector type). |
| **EXPECTED** | Matched by `agents/<id>/ignore.json` (`compare` counts these as "ignored") or explained by one of its `reminders`. Not reported, only counted. |

Then check what the diff can't see, reading config files directly against
the docs listed in `notes.md`:

- **Permissions** beyond Read: is each rule's `decision`, `matchesFile` and
  `overridden` right per the documented precedence and matching rules?
- **Hooks**: every hook in every layer present, and `firesOnEdit` right for
  its matcher?
- **MCP state**: `enabled` / `disabled` / `unapproved` right per the
  approval settings?
- **What the UI does with it**: if a category looks right in `app.json` but
  the user says the app shows otherwise, check
  `apps/desktop/src/renderer/src/lib/derive.ts` — it filters and regroups
  before anything renders.

### 4. Sweep for new surfaces

Compare the adapter's `version` with `validatedVersion` in `ignore.json`
(`compare` prints a NOTE when they differ). If it is
newer, find the changelog entries between the two (`notes.md` says where;
for a subagent, pass an explicit model — `sonnet` at low effort is enough)
that touch where the agent reads instructions, memory, settings, permissions,
hooks, skills, subagents, MCP servers or plugins. Check each against
`packages/core/src/types.ts` and report the ones the app doesn't model as
**NEW**. Also flag documented settings keys or frontmatter fields the app
parses the old way.

### 5. Report

Lead with counts: `N wrong · N missing · N new · N expected`. Then one row per
finding, most user-visible first:

| # | Label | What | Evidence | Likely fix |
|---|---|---|---|---|

- **Evidence** names the file on disk and what the agent did with it
  (view field, debug line, self-report, doc link).
- **Likely fix** points at the function in `packages/core/src` (or the
  renderer) that would change.

Don't change the resolver unless the user asks — this skill reports.
Offer to add accepted differences to `ignore.json` and bump
`validatedVersion`; edit it only after the user agrees.

## Adapter contract

`agents/<id>/view.mjs <folder> [target]` runs the agent in `<folder>`
without letting it change anything, reads `<target>` when it is a file, and
prints one JSON object:

```jsonc
{
  "agent": "<id>",
  "version": "1.2.3",               // agent version, for the changelog sweep
  "folder": "/abs", "target": "/abs" | null,
  "instructions": {
    "start": ["/abs/path", ...],    // instruction/memory files in context at start
    "afterRead": ["/abs/path"] | null  // added by reading the target; null for dirs
  },
  "skills": ["name", ...],          // as the agent names them
  "agents": ["name", ...],          // subagents
  "mcpServers": [{ "name": "", "status": "", "source": "" }],
  "plugins": [{ "name": "", "source": "", "path": "" }],
  "read": "allowed" | "denied or failed: ..." | null,
  "hooks": [{ "subtype": "", "event": "", "name": "" }],
  "debug": ["log lines about config it read or skipped"],
  "extra": { }                      // anything agent-specific worth keeping
}
```

Any field the agent can't report is `null`, never `[]` — `[]` means "the
agent says there are none", and `compare` would flag everything the app
shows. Prefer machine output (init events, `--json` flags, debug logs) over
asking the model; when you must ask, say so in `notes.md`.

Each adapter folder also gets a `notes.md` (how it runs, what to trust, side
effects, docs and changelog links, limits) and an `ignore.json`:

```jsonc
{
  "validatedVersion": "1.2.3",
  "ignore": [
    // side: "app" or "agent"; category: instructions | skills | agents | mcpServers | plugins
    { "category": "skills", "side": "agent", "names": ["..."], "reason": "why this is fine" },
    { "category": "plugins", "side": "agent", "pattern": "regex", "reason": "..." }
  ],
  // differences that need judgment, not a name match; printed after the diff
  "reminders": ["..."]
}
```

Every entry needs a `reason`. Ignore by exact name where you can, so a
new bundled item shows up as a difference instead of hiding under a pattern.

If the app's resolver starts taking an agent, pass `--agent <id>` through to
`app-view.mjs` too. Today it only resolves Claude Code.
