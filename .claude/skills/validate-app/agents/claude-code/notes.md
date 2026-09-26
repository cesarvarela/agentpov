# Claude Code adapter

## What `view.mjs` does

Runs `claude -p` in the folder with only the Read tool, `dontAsk`
permissions, `--output-format stream-json --include-hook-events`,
`--debug-file`, and `--settings` carrying one `InstructionsLoaded` hook that
logs every instruction file Claude Code loads. One short Sonnet session.

`--config-dir <dir>` runs it with `CLAUDE_CONFIG_DIR=<dir>`, an isolated user
config (build one with `make-fixture.mjs --config <dir>`), and `app-view.mjs`
takes the same flag. There's no login in that dir, so the model never runs:
the init event and the session-start `InstructionsLoaded` events still arrive
(exact), but `afterRead`, `read` and the self-report are `null`/empty.

| Field | Source | Trust |
|---|---|---|
| `skills`, `agents`, `mcpServers`, `plugins`, `version` | stream-json `init` event | exact |
| `debug` | debug log: settings files checked (missing ones log as "Broken symlink or missing file"), skill/agent dirs scanned, plugins, hook registry | exact |
| `hooks` | hook lifecycle events in the stream | exact for events that fired |
| `read` | the Read tool result on the target | exact |
| `instructions` | `InstructionsLoaded` hook events (`session_start` → `start`; `nested_traversal`/`path_glob_match` → `afterRead`; `include` follows its parent), plus the model's self-report only for files the hook can't see: `AGENTS.md` read directly and auto-memory files | exact, except the self-reported part — rerun once when that disagrees with disk |
| `extra.instructionsLoaded` | every hook event with `load_reason`, `memory_type`, trigger and parent | exact |
| `extra.selfReport` | the model's raw START/READ lists | self-report |
| `extra.output_style` | `init` event | exact |
| `extra.memory_paths` | `init` event: the auto-memory directory the CLI uses | exact |

**Side effect:** the folder's hooks run (SessionStart, UserPromptSubmit,
PreToolUse:Read, ...). Read them before running on an unfamiliar folder.

## Docs

- Memory and CLAUDE.md: https://code.claude.com/docs/en/memory
- Settings, precedence, permissions: https://code.claude.com/docs/en/settings, https://code.claude.com/docs/en/iam
- Hooks: https://code.claude.com/docs/en/hooks
- Skills: https://code.claude.com/docs/en/skills
- Subagents: https://code.claude.com/docs/en/sub-agents
- MCP: https://code.claude.com/docs/en/mcp
- Plugins: https://code.claude.com/docs/en/plugins
- Changelog: ask a `claude-code-guide` agent (model `sonnet`, low effort) for
  entries between two versions.

## Limits

- Known gaps in the resolver are listed in `packages/core/NOT-MODELED.md`;
  a difference explained there is EXPECTED, and a newly found one belongs there
  until it is fixed.

- **`InstructionsLoaded` doesn't fire for `AGENTS.md` read directly** (docs:
  /hooks#instructionsloaded) or for auto memory, so those two still rely on the
  model. A folder with `disableAllHooks` in its settings may also silence the
  logging hook.
- **Saved workflows are listed as skills** in the `init` event (`release`,
  `kit:kit-flow`); `compare` adds the app's workflows to the skills diff.
- **Project-scope plugins need workspace trust**, which `-p` never grants, so
  a project skills-dir plugin shows in the app but not here. Validate plugins
  with `--config-dir` and user-scope installs instead.
- **Sandbox, output style list, workflows' disabled state, hook sources** have
  no machine-readable field in the CLI; check them against the files and docs.

- **MCP approval can't be read from the CLI yet.** `claude -p` connects every
  `.mcp.json` server, approved or not (seen on 2.1.280). `claude mcp list`
  hides disabled servers but shows every other `.mcp.json` server as "Pending
  approval", even ones listed in `enabledMcpjsonServers` in project or local
  settings — probably because the folder was never trusted interactively.
  Check `enabled` / `disabled` / `unapproved` against the MCP docs instead.
- `init.skills` is taken at startup, so nested skills and anything loaded
  after reading the target never show up there.
- The debug log's `Loaded N unique skills (... legacy commands: N)` line is
  the only place `.claude/commands` entries show up.
- The user's own `~/.claude` is part of both views; findings that depend on
  it say so.
