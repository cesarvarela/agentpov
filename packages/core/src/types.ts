/**
 * Config layers, ordered from lowest to highest precedence.
 *
 * Managed → User → Project → Local → Directory
 */
export type ConfigLayer =
  | "managed"
  | "user"
  | "project"
  | "local"
  | "directory";

export const CONFIG_LAYER_PRECEDENCE: readonly ConfigLayer[] = [
  "managed",
  "user",
  "project",
  "local",
  "directory",
] as const;

/** A single file on disk that contributed something to the resolved context. */
export interface ConfigSource {
  /** Absolute path of the file this came from. */
  path: string;
  /** Which precedence layer the file belongs to. */
  layer: ConfigLayer;
}

export type MemoryKind =
  | "claude-md"
  /** A `.claude/rules/*.md` file. */
  | "rule"
  | "import"
  | "memory-index"
  | "memory-file";

/**
 * How Claude Code pulls the file into context.
 *
 * - `always`: in context from the start of every session.
 * - `on-read`: pulled in when a file at or under its directory is read.
 * - `on-demand`: only recalled when something asks for it.
 */
export type MemoryLoading = "always" | "on-read" | "on-demand";

/** Whether a resolution ran against a single file or a whole directory. */
export type TargetKind = "file" | "directory";

/** A CLAUDE.md / memory file that applies to the resolved target. */
export interface MemoryEntry extends ConfigSource {
  kind: MemoryKind;
  /** Raw markdown content, if it was read. */
  content?: string;
  /** Size in bytes, if known. */
  bytes?: number;
  /**
   * One line saying what the file is: its frontmatter `description`, else its
   * first non-blank line after the frontmatter.
   */
  summary?: string;
  /**
   * For `rule`: the `paths:` globs it declares, as written (project-relative,
   * before brace expansion). Absent when the rule always loads.
   */
  appliesToGlobs?: string[];
  /** For `import`: absolute path of the CLAUDE.md that imported it. */
  importedBy?: string;
  /** For `import`: 1-based line of the `@path` reference in the parent. */
  importedAtLine?: number;
  /** Why it is in context, e.g. "always loaded", "loaded when this file is read". */
  reason: string;
  /** Machine-readable form of `reason`: how the file reaches context. */
  loading: MemoryLoading;
  /**
   * True when it is only in context because of where the target sits: a
   * `CLAUDE.md` in the target's own directory chain rather than a layer that
   * always loads.
   */
  scopedToFile: boolean;
}

export type PermissionDecision = "allow" | "ask" | "deny";

/** One permission rule, e.g. `Bash(git push:*)` → deny. */
export interface PermissionRule extends ConfigSource {
  /** Rule text as written in settings, e.g. `Read(./.env)`. */
  rule: string;
  /** Tool name portion of the rule, e.g. `Read`. */
  tool: string;
  /** Specifier inside the parentheses, if any, e.g. `./.env`. */
  specifier?: string;
  decision: PermissionDecision;
  /**
   * True when this rule hits the resolved target: for a file, its specifier
   * matches the file's path; for a directory, the specifier could cover
   * something at or below that directory.
   */
  matchesFile: boolean;
  /** True when a higher-precedence rule overrode this one. */
  overridden: boolean;
  /** Layer of the rule that overrode this one, when overridden. */
  overriddenBy?: ConfigLayer;
}

/** A hook registered for some lifecycle event. */
export interface HookEntry extends ConfigSource {
  /** e.g. `PreToolUse`, `PostToolUse`, `SessionStart`. */
  event: string;
  /** Tool matcher the hook is scoped to, if any, e.g. `Edit|Write`. */
  matcher?: string;
  command: string;
  timeoutSeconds?: number;
  /** True when the matcher would fire for an Edit/Write of the target. */
  firesOnEdit: boolean;
}

/**
 * Where a skill came from.
 *
 * - `personal`: `~/.claude/skills/<name>/SKILL.md`
 * - `synced`: `~/.claude/skills/synced/<id>/<name>/SKILL.md`, synced from
 *   claude.ai; loads like a personal skill.
 * - `project`: `<folder>/.claude/skills/<name>/SKILL.md`
 * - `nested`: `<subdir>/.claude/skills/<name>/SKILL.md` for a directory below
 *   the project root; loads once Claude touches a file there.
 * - `plugin`: `~/.claude/plugins/**​/<plugin>/skills/<name>/SKILL.md`
 */
export type SkillSource = "personal" | "synced" | "project" | "nested" | "plugin";

/** The file that won a name collision, and the layer it came from. */
export type ShadowedBy = ConfigSource;

export interface SkillEntry extends ConfigSource {
  /** Display name: frontmatter `name`, namespaced for plugin/nested skills. */
  name: string;
  /**
   * The name the skill is invoked by, before namespacing — the skill's own
   * directory name. Docs: for personal and project skills the command name
   * comes from the directory, and frontmatter `name` is only a display label.
   * Collisions are decided on this.
   */
  shortName: string;
  description?: string;
  /** Frontmatter `allowed-tools`, as a list (comma/space string or YAML list). */
  allowedTools?: string[];
  source: SkillSource;
  /** For `plugin`: the plugin directory name used as the namespace. */
  plugin?: string;
  /** For `nested`: the subdirectory, relative to the project root. */
  subdir?: string;
  /**
   * Set when a higher-precedence skill of the same `shortName` wins, so the UI
   * can strike this one through. Precedence: enterprise/managed > personal >
   * project > bundled.
   */
  shadowedBy?: ShadowedBy;
}

export interface AgentEntry extends ConfigSource {
  name: string;
  description?: string;
  /** Frontmatter `tools` (comma-separated string or YAML list). */
  tools?: string[];
  /** Frontmatter `disallowedTools`. */
  disallowedTools?: string[];
  /** `sonnet`, `opus`, `haiku`, `fable`, a full model id, or `inherit`. */
  model?: string;
  /** `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`, `manual`. */
  permissionMode?: string;
  maxTurns?: number;
  /** Skills preloaded into the subagent at startup. */
  skills?: string[];
  /** MCP servers exposed to the subagent. */
  mcpServers?: string[];
  /** Persistent memory scope: `user`, `project`, or `local`. */
  memory?: string;
  background?: boolean;
  /** `low`, `medium`, `high`, `xhigh`, `max`. */
  effort?: string;
  /** e.g. `worktree`. */
  isolation?: string;
  color?: string;
  /**
   * Set when a higher-precedence subagent of the same name wins. Docs:
   * `.claude/agents/` (project) outranks `~/.claude/agents/` (user).
   */
  shadowedBy?: ShadowedBy;
}

/**
 * Whether Claude Code would actually expose a `.mcp.json` server.
 *
 * - `enabled`: approved, via `enableAllProjectMcpServers` or
 *   `enabledMcpjsonServers` (or it comes from user config, always enabled).
 * - `disabled`: listed in `disabledMcpjsonServers` in some layer.
 * - `unapproved`: nothing approved it, so the CLI would prompt on first run.
 */
export type McpServerState = "enabled" | "disabled" | "unapproved";

export interface McpServerEntry extends ConfigSource {
  name: string;
  transport: "stdio" | "http" | "sse" | "unknown";
  /** Command (stdio) or URL (http/sse). */
  target?: string;
  /** The declared `type` field, when the entry has one. */
  type?: "stdio" | "http" | "sse";
  /** Environment overrides declared for a stdio server. */
  env?: Record<string, string>;
  /** Headers declared for an http/sse server. */
  headers?: Record<string, string>;
  state: McpServerState;
  /** Why `state` is what it is, naming the settings file and key that decided. */
  reason: string;
  /** Absolute path of the settings file that decided `state`, when one did. */
  stateSource?: string;
  /** The settings key that decided `state`, when one did. */
  stateKey?: string;
}

/** Effective settings merged across all layers, with provenance kept. */
export interface SettingsEntry extends ConfigSource {
  /** Parsed JSON body of the settings file. */
  values: Record<string, unknown>;
}

/** Everything that shapes how an agent sees one file or folder inside a project. */
export interface ResolvedContext {
  /** Absolute path of the project folder the resolution ran against. */
  folder: string;
  /**
   * Absolute path of the resolved target. Named `file` for compatibility, but
   * it is a directory when `targetKind` is `"directory"`.
   */
  file: string;
  /** Whether `file` is a single file or a directory. */
  targetKind: TargetKind;
  memory: MemoryEntry[];
  settings: SettingsEntry[];
  permissions: PermissionRule[];
  hooks: HookEntry[];
  skills: SkillEntry[];
  agents: AgentEntry[];
  mcpServers: McpServerEntry[];
  /** Non-fatal problems hit while resolving (unreadable file, bad JSON, ...). */
  diagnostics: string[];
}

/** Minimal filesystem the resolver needs; injectable for tests and what-if runs. */
export interface FileSystemReader {
  /** Returns file contents as UTF-8, or null when the path does not exist or is not a file. */
  readFile(path: string): Promise<string | null>;
  /** Lists entry names of a directory, or null when it does not exist. */
  readDir(path: string): Promise<{ name: string; isDirectory: boolean }[] | null>;
  /** Byte size of a file, or null when it does not exist. */
  fileSize(path: string): Promise<number | null>;
}

export interface ResolveOptions {
  fs: FileSystemReader;
  /**
   * Whether the target is a file or a directory; defaults to `"file"`. The
   * caller decides — the resolver never stats the target itself.
   */
  targetKind?: TargetKind;
  /** Absolute home directory, used for the user layer (`~/.claude`). */
  homeDir: string;
  /** Absolute managed-settings path override; defaults per platform. */
  managedSettingsPath?: string;
  /** Platform, defaults to process.platform. */
  platform?: NodeJS.Platform;
}
