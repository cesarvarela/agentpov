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

export type MemoryKind = "claude-md" | "import" | "memory-index" | "memory-file";

/** A CLAUDE.md / memory file that applies to the selected file. */
export interface MemoryEntry extends ConfigSource {
  kind: MemoryKind;
  /** Raw markdown content, if it was read. */
  content?: string;
  /** Size in bytes, if known. */
  bytes?: number;
  /** For `import`: absolute path of the CLAUDE.md that imported it. */
  importedBy?: string;
  /** For `import`: 1-based line of the `@path` reference in the parent. */
  importedAtLine?: number;
  /** Why it is in context, e.g. "always loaded", "loaded when this file is read". */
  reason: string;
  /** True when it is only in context because of the selected file's directory. */
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
  /** True when this rule's specifier matches the selected file's path. */
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
  /** True when the matcher would fire for an Edit/Write of the selected file. */
  firesOnEdit: boolean;
}

export interface SkillEntry extends ConfigSource {
  name: string;
  description?: string;
}

export interface AgentEntry extends ConfigSource {
  name: string;
  description?: string;
}

export interface McpServerEntry extends ConfigSource {
  name: string;
  transport: "stdio" | "http" | "sse" | "unknown";
  /** Command (stdio) or URL (http/sse). */
  target?: string;
}

/** Effective settings merged across all layers, with provenance kept. */
export interface SettingsEntry extends ConfigSource {
  /** Parsed JSON body of the settings file. */
  values: Record<string, unknown>;
}

/** Everything that shapes how an agent sees one file inside one folder. */
export interface ResolvedContext {
  /** Absolute path of the project folder the resolution ran against. */
  folder: string;
  /** Absolute path of the file whose context was resolved. */
  file: string;
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
  /** Absolute home directory, used for the user layer (`~/.claude`). */
  homeDir: string;
  /** Absolute managed-settings path override; defaults per platform. */
  managedSettingsPath?: string;
  /** Platform, defaults to process.platform. */
  platform?: NodeJS.Platform;
}
