# Known gaps

Differences between agentpov and Claude Code that are accepted, so
validate-app counts them instead of reporting them. Each is a rule, not a
list of names, because the names change between CLI versions.

Last validated against Claude Code: **2.1.280**

## Accepted

- **Bundled skills.** Skills in `init.skills` with no `SKILL.md` anywhere
  under the dirs the debug log says it scanned ship inside the CLI binary.
  agentpov shows files on disk, and these have none.
- **Built-in subagents.** `claude`, `claude-code-guide`, `Explore`,
  `general-purpose`, `Plan`, `statusline-setup` and any other agent in
  `init.agents` with no `.md` file on disk.
- **Built-in plugins.** Plugins whose `path` is `builtin` in `init.plugins`.

## Oracle quirks

Not app bugs — places where the headless session under-reports.

- **`user-invocable: false` skills** are left out of `init.skills` but the
  model still gets them. A skill that is ONLY APP with that frontmatter is
  correct in the app.
