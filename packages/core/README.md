# @agentview/core

The resolution engine behind agentview. Given a project folder and a file
inside it, it answers: **what does a coding agent actually see here?**

Today this package is a stub — `resolveContext(folder, file)` returns a
well-typed empty `ResolvedContext`. The types in `src/types.ts` are the real
contract and are already shaped for the full implementation.

## What it will do

`resolveContext(folder, file)` will collect, with provenance for every item:

- **Memory / instructions** — every `CLAUDE.md` that applies to `file`: the
  enterprise-managed one, the user's `~/.claude/CLAUDE.md`, the project root
  one, imported files, and any `CLAUDE.md` in directories between the project
  root and the file itself.
- **Settings** — `settings.json` at each layer, merged, keeping which file each
  effective value came from.
- **Permission rules** — `allow` / `ask` / `deny` rules, matched against the
  selected file and against candidate tool calls, marking which rules are
  shadowed by a higher-precedence layer.
- **Hooks** — which hooks are registered for which lifecycle events
  (`PreToolUse`, `PostToolUse`, `SessionStart`, …), with their matchers, so a
  hook that never fires for this file is visible as such.
- **Skills, subagents and MCP servers** — what is available in this folder and
  where each one is defined.

## Precedence

Layers are applied lowest to highest; a later layer wins:

```
Managed  →  User  →  Project  →  Local  →  Directory
```

| Layer | Typical source |
|---|---|
| Managed | system-wide managed policy settings |
| User | `~/.claude/` (settings, CLAUDE.md, skills, agents) |
| Project | `<repo>/.claude/settings.json`, `<repo>/CLAUDE.md` |
| Local | `<repo>/.claude/settings.local.json` (git-ignored, per-developer) |
| Directory | `CLAUDE.md` / config in subdirectories on the path to the file |

The exception is `deny`: a deny rule at any layer is not overridden by an
`allow` at a higher layer. That asymmetry will be modelled explicitly rather
than falling out of a generic merge.

## Design goals

- **Pure and side-effect free at the API edge.** Filesystem access goes through
  an injectable reader so the resolver can be tested against fixtures and, later,
  run against a hypothetical ("what if I added this rule?") tree.
- **Provenance always.** Every entry carries the absolute path and layer it came
  from — the UI is built entirely around "why is this here?".
- **Agent-agnostic shape.** Claude Code first, but the result type deliberately
  avoids Claude-specific field names where a neutral one exists.

## Scripts

```bash
pnpm --filter @agentview/core build      # tsc → dist/
pnpm --filter @agentview/core typecheck
pnpm --filter @agentview/core test       # vitest
```
