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
  /**
   * An `AGENTS.md` / `.claude/AGENTS.md` read directly through the built-in
   * `agents-md` plugin (Claude Code 2.1.277+), not through an `@import`.
   */
  | "agents-md"
  /** Text from the managed `claudeMd` setting; `path` is the settings file. */
  | "inline"
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
  /** For `import`: absolute path of the CLAUDE.md, AGENTS.md or rule that imported it. */
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
  /**
   * Set when Claude Code drops the rule entirely, e.g. a non-managed rule
   * under managed `allowManagedPermissionRulesOnly`, or a `Write(path)` rule
   * Claude Code never consults. Says why. An ignored rule never overrides
   * another and is never marked overridden; `matchesFile` still says whether
   * its specifier would hit the target.
   */
  ignored?: string;
  /**
   * Rule text of the later `!` deny/ask pattern in the same list that carves
   * the target out of this rule (gitignore negation). `matchesFile` is false
   * when set.
   */
  carvedOutBy?: string;
}

/**
 * Where a hook was declared.
 *
 * - `settings`: a settings file's `hooks` key (`path` is the settings file)
 * - `plugin`: an enabled plugin's `hooks/hooks.json` or manifest `hooks`
 * - `skill`: a skill's frontmatter `hooks:`; active once the skill is invoked
 * - `agent`: a subagent's frontmatter `hooks:`; active only while it runs
 */
export type HookSource = "settings" | "plugin" | "skill" | "agent";

/** A hook registered for some lifecycle event. */
export interface HookEntry extends ConfigSource {
  /** e.g. `PreToolUse`, `PostToolUse`, `SessionStart`. */
  event: string;
  /** Tool matcher the hook is scoped to, if any, e.g. `Edit|Write`. */
  matcher?: string;
  /**
   * What runs: the shell command for `command` hooks, the URL for `http`
   * hooks, the prompt text for `prompt`/`agent` hooks.
   */
  command: string;
  /** Handler `type` as written: `command`, `http`, `prompt`, `agent`, ... */
  type?: string;
  timeoutSeconds?: number;
  /** True when the matcher would fire for an Edit/Write of the target. */
  firesOnEdit: boolean;
  /** Where it was declared; absent means `settings`. */
  source?: HookSource;
  /** For `plugin` hooks: the plugin name. */
  plugin?: string;
  /** For `skill` / `agent` hooks: the skill or subagent that declares it. */
  owner?: string;
  /**
   * When it is registered, for hooks that aren't always on: a skill's hooks
   * once the skill is invoked, a subagent's only while it runs (and a `Stop`
   * written there is registered as `SubagentStop`).
   */
  note?: string;
  /**
   * Set when Claude Code would not run it (`disableAllHooks`,
   * `allowManagedHooksOnly`, `strictPluginOnlyCustomization`, ...). Says why.
   */
  disabled?: string;
}

/**
 * Where a skill came from.
 *
 * - `managed`: `.claude/skills/<name>/SKILL.md` inside the managed settings
 *   directory (enterprise skills)
 * - `personal`: `~/.claude/skills/<name>/SKILL.md`
 * - `synced`: `~/.claude/skills/synced/<id>/<name>/SKILL.md`, synced from
 *   claude.ai; loads like a personal skill.
 * - `project`: `.claude/skills/<name>/SKILL.md` in the project folder or any
 *   folder above it up to the git root
 * - `nested`: `<subdir>/.claude/skills/<name>/SKILL.md` for a directory below
 *   the project root; loads once Claude touches a file there.
 * - `plugin`: `~/.claude/plugins/**​/<plugin>/skills/<name>/SKILL.md`, or a
 *   plugin kept in `~/.claude/skills/<dir>` (one with `.claude-plugin/plugin.json`)
 * - `command`: a legacy `.claude/commands/<name>.md`, user or project
 */
export type SkillSource =
  | "managed"
  | "personal"
  | "synced"
  | "project"
  | "nested"
  | "plugin"
  | "command";

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
  /**
   * Set when Claude Code would not offer it at all (`skillOverrides`,
   * `strictPluginOnlyCustomization`, ...). Says why.
   */
  disabled?: string;
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
  /** For a plugin subagent: the plugin name (its namespace). */
  plugin?: string;
  /** Set when Claude Code would not offer it (`strictPluginOnlyCustomization`, ...). Says why. */
  disabled?: string;
}

/**
 * Whether Claude Code would actually expose a `.mcp.json` server.
 *
 * - `enabled`: approved, via `enableAllProjectMcpServers` or
 *   `enabledMcpjsonServers` (or it comes from user config, always enabled).
 * - `disabled`: listed in `disabledMcpjsonServers` in some layer.
 * - `unapproved`: nothing approved it, so the CLI would prompt on first run.
 * - `blocked`: managed policy keeps it out whatever the approval says
 *   (`managed-mcp.json` exclusive control, `deniedMcpServers`,
 *   `allowedMcpServers`, `strictPluginOnlyCustomization`).
 */
export type McpServerState = "enabled" | "disabled" | "unapproved" | "blocked";

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
  /** For a plugin server: the plugin name. Its display `name` is `plugin:<plugin>:<server>`. */
  plugin?: string;
}

/**
 * Where a plugin was found. The id is `<name>@<origin>`, where origin is the
 * marketplace name for `marketplace` plugins and literally `skills-dir` or
 * `synced` for the other two.
 */
export type PluginOrigin = "marketplace" | "skills-dir" | "synced";

/** A plugin Claude Code knows about, enabled or not. */
export interface PluginEntry extends ConfigSource {
  /** `<name>@<marketplace>`, `<name>@skills-dir` or `<name>@synced`. */
  id: string;
  /** Namespace its components use: the manifest `name`, else the id's name part. */
  name: string;
  origin: PluginOrigin;
  /** Marketplace name, for `marketplace` plugins. */
  marketplace?: string;
  /** Plugin root on disk (`${CLAUDE_PLUGIN_ROOT}`), when it was found. */
  root?: string;
  version?: string;
  description?: string;
  enabled: boolean;
  /** Why `enabled` is what it is, naming the settings file or manifest key. */
  reason: string;
  /** Settings file whose `enabledPlugins` entry decided it, when one did. */
  stateSource?: string;
}

/** An output style (`.claude/output-styles/*.md` or a plugin's). */
export interface OutputStyleEntry extends ConfigSource {
  /** Frontmatter `name`, else the file name; `<plugin>:<name>` for plugins. */
  name: string;
  description?: string;
  /** Frontmatter `keep-coding-instructions`. */
  keepCodingInstructions?: boolean;
  /** For a plugin style: the plugin name. */
  plugin?: string;
  /** Frontmatter `force-for-plugin` (plugins only): applies whatever `outputStyle` says. */
  forceForPlugin?: boolean;
  /** True for the style the session would use. */
  active: boolean;
  /** Set when a closer or higher-precedence style of the same name wins. */
  shadowedBy?: ShadowedBy;
}

/** A saved workflow (`.claude/workflows/*.js` or a plugin's `workflows/`). */
export interface WorkflowEntry extends ConfigSource {
  /** `meta.name`, else the file name; `<plugin>:<name>` for plugins. */
  name: string;
  description?: string;
  plugin?: string;
  shadowedBy?: ShadowedBy;
  /** Set when workflows are turned off (`disableWorkflows`, ...). Says why. */
  disabled?: string;
}

/**
 * A single setting's effective value and where it came from. `source` is
 * absent when nothing set it and `value` is Claude Code's default.
 */
export interface EffectiveValue<T> {
  value: T;
  /** Settings key path as documented, e.g. `permissions.defaultMode`. */
  key: string;
  source?: ConfigSource;
  /** Anything non-obvious about how the value was decided. */
  note?: string;
}

/** `pluginConfigs["agents-md@builtin"].options.instructionFiles`. */
export type InstructionFilesMode =
  | "claude-md-or-agents-md"
  | "claude-md-and-agents-md"
  | "claude-md"
  | "managed-only";

/** Session-wide switches that change what the lists in `ResolvedContext` mean. */
export interface EffectiveSettings {
  /** `permissions.defaultMode`; `auto`/`bypassPermissions` are ignored in project and local files. */
  permissionMode: EffectiveValue<string>;
  /** `outputStyle`, default `Default`. */
  outputStyle: EffectiveValue<string>;
  /** Which instruction files load (the built-in `agents-md` plugin's option). */
  instructionFiles: EffectiveValue<InstructionFilesMode>;
  /** `autoMemoryEnabled`, default true. */
  autoMemory: EffectiveValue<boolean>;
  /** `disableAllHooks`. */
  disableAllHooks: EffectiveValue<boolean>;
  /** `allowManagedHooksOnly` (managed only). */
  allowManagedHooksOnly: EffectiveValue<boolean>;
  /** Workflows on: false under `disableWorkflows`. */
  workflows: EffectiveValue<boolean>;
}

/** Which sandbox path list an entry comes from. */
export type SandboxPathKind = "allowWrite" | "denyWrite" | "allowRead" | "denyRead";

/** One path in `sandbox.filesystem.*`, or one a permission rule feeds into it. */
export interface SandboxPathRule extends ConfigSource {
  kind: SandboxPathKind;
  /** As written in settings (or the permission rule's specifier). */
  pattern: string;
  /** Absolute form after the documented prefix rules. */
  resolved: string;
  /** True when it covers the resolved target (or something under a directory target). */
  matchesTarget: boolean;
  /** Set when the entry comes from a permission rule (`Edit(...)`, `Read(...)`), e.g. `Edit(./dist/**)`. */
  fromPermission?: string;
  /** Set when the entry is a `sandbox.credentials.files` entry that blocks reads. */
  fromCredentials?: "deny" | "mask";
  /** Set when Claude Code drops the entry (managed-only lock, Linux wildcard, ...). Says why. */
  ignored?: string;
}

/** A value from a list-valued sandbox key, with the file that added it. */
export interface SandboxListItem extends ConfigSource {
  value: string;
  /** Set when the value comes from a `WebFetch(domain:...)` permission rule. */
  fromPermission?: string;
  /** Set when Claude Code drops the value (e.g. `allowManagedDomainsOnly`). Says why. */
  ignored?: string;
}

/**
 * The Bash sandbox. It restricts only Bash (and PowerShell/Monitor) commands
 * and their children; Read/Edit/Write stay under permission rules.
 */
export interface SandboxSummary {
  enabled: EffectiveValue<boolean>;
  autoAllowBashIfSandboxed: EffectiveValue<boolean>;
  allowUnsandboxedCommands: EffectiveValue<boolean>;
  /** `sandbox.filesystem.disabled` (user or managed only): filesystem isolation off. */
  filesystemDisabled: EffectiveValue<boolean>;
  excludedCommands: SandboxListItem[];
  filesystem: SandboxPathRule[];
  allowedDomains: SandboxListItem[];
  deniedDomains: SandboxListItem[];
  /**
   * What a sandboxed Bash command could do to the target. `null` when the
   * sandbox is off.
   */
  target: {
    read: "allowed" | "denied";
    write: "allowed" | "denied";
    /** One line naming the rule or default that decided each. */
    reason: string;
  } | null;
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
  plugins: PluginEntry[];
  outputStyles: OutputStyleEntry[];
  workflows: WorkflowEntry[];
  sandbox: SandboxSummary;
  effective: EffectiveSettings;
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
  /**
   * Claude Code's user config directory when `CLAUDE_CONFIG_DIR` is set.
   * Replaces `~/.claude`, and `.claude.json` moves inside it. Defaults to
   * `<homeDir>/.claude`.
   */
  configDir?: string;
  /** Absolute managed-settings path override; defaults per platform. */
  managedSettingsPath?: string;
  /** Platform, defaults to process.platform. */
  platform?: NodeJS.Platform;
}
