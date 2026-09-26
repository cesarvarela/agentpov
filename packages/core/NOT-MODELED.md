# What the resolver doesn't model yet

Checked against Claude Code 2.1.280 (docs as of 2.1.283). Everything else the
docs describe for instructions, settings, permissions, hooks, skills,
subagents, MCP, plugins, output styles, workflows and the Bash sandbox is
modeled and validated with `.claude/skills/validate-app`.

Grouped by how much each one changes what the app shows.

## Changes results for real projects

- **Workspace trust.** Claude Code holds some project config back until the
  folder is trusted: project plugins (including `.claude/skills` plugins and
  their MCP servers), project subagents' frontmatter `hooks`,
  `permissions.additionalDirectories` from project settings,
  `extraKnownMarketplaces`. The resolver assumes a trusted folder. Trust is
  recorded per project in `~/.claude.json`, so it can be read and shown as
  "needs trust" instead of loaded. `claude -p` never grants trust.
- **Managed sources other than files.** Server-managed settings (claude.ai or
  a gateway), the macOS `com.anthropic.claudecode` profile, the Windows
  HKLM/HKCU registry, and `managedSourcesBehavior` (`first-wins` vs `merge`).
  Only `managed-settings.json` + `managed-settings.d/` are read.
- **Environment variables.** Only `CLAUDE_CONFIG_DIR` is honoured (desktop,
  local folders). Not yet: `CLAUDE_CODE_DISABLE_AUTO_MEMORY`,
  `CLAUDE_CODE_DISABLE_WORKFLOWS`, `CLAUDE_CODE_PLUGIN_DIRS`,
  `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`,
  `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, `CLAUDE_CODE_PLUGIN_CACHE_DIR`.

## Gaps inside surfaces that are modeled

- A subdirectory's own `.claude/rules/` loading when a file there is read.
- Subagent files with no `name` or `description` are skipped by Claude Code;
  the resolver still lists them.
- Hook `if` conditions; `allowedHttpHookUrls` / `httpHookAllowedEnvVars`
  gating `http` hooks.
- `@imports` inside the managed `claudeMd` text.
- A `CLAUDE.md` that symlinks to `AGENTS.md` shows twice: `FileSystemReader`
  can't see symlinks.
- `permissions.blockReadsOutsideWorkingDirectories` only feeds the sandbox
  verdict, not the Read verdict.
- Sandbox details: `$TMPDIR` as a default writable path,
  `network.strictAllowlist`, the exact protected-path list.

## Not knowable from disk

Session inputs Claude Code gets from how it was started, not from files:

- CLI flags: `--add-dir`, `--settings`, `--setting-sources`, `--plugin-dir`,
  `--plugin-url`, `--permission-mode`, `--mcp-config`, `--strict-mcp-config`,
  `--agents`.
- The account's plan (workflows are off by default on Pro) and claude.ai
  synced skills/plugins that haven't been downloaded yet.

**Closing this with a CLI launch.** Started the way Claude Code is — `cd`
into the project and run `agentpov [claude flags…]` — the app would resolve
exactly what `claude [same flags]` would see there: the working directory is
the project, the environment variables above come from that shell, and the
flags are the ones `claude` takes, passed into `resolveContext` as session
options. That turns the env-var group and most of this group into modeled
inputs. Trust, non-file managed sources and the plan stay out of reach.

## Low value

Plugin LSP servers, monitors and themes; `statusLine` /
`subagentStatusLine`.
