# Claude Code adapter

## What `view.mjs` does

Runs `claude -p` in the folder with only the Read tool, `dontAsk`
permissions, `--output-format stream-json --include-hook-events` and
`--debug-file`. One short Sonnet session.

| Field | Source | Trust |
|---|---|---|
| `skills`, `agents`, `mcpServers`, `plugins`, `version` | stream-json `init` event | exact |
| `debug` | debug log: settings files checked (missing ones log as "Broken symlink or missing file"), skill/agent dirs scanned, plugins, hook registry | exact |
| `hooks` | hook lifecycle events in the stream | exact for events that fired |
| `read` | the Read tool result on the target | exact |
| `instructions` | the model listing its own "Contents of <path>" headers, before and after the Read | self-report — rerun once when it disagrees with disk |
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

- Headless sessions don't prompt, so `.mcp.json` servers that would ask for
  approval interactively may just be absent from `mcpServers`.
- The user's own `~/.claude` is part of both views; findings that depend on
  it say so.
