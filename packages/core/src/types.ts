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

/** A CLAUDE.md / memory file that applies to the selected file. */
export interface MemoryEntry extends ConfigSource {
  /** Raw markdown content, if it was read. */
  content?: string;
}

export type PermissionDecision = "allow" | "ask" | "deny";

/** One permission rule, e.g. `Bash(git push:*)` → deny. */
export interface PermissionRule extends ConfigSource {
  /** Rule text as written in settings, e.g. `Read(./.env)`. */
  rule: string;
  decision: PermissionDecision;
  /** True when a higher-precedence rule overrode this one. */
  overridden: boolean;
}

/** A hook registered for some lifecycle event. */
export interface HookEntry extends ConfigSource {
  /** e.g. `PreToolUse`, `PostToolUse`, `SessionStart`. */
  event: string;
  /** Tool matcher the hook is scoped to, if any. */
  matcher?: string;
  command: string;
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
