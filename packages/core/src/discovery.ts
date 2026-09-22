import {
  listDir,
  projectClaudeDir,
  readText,
  userClaudeDir,
  type ResolveRun,
} from "./context.js";
import { parseFrontmatter } from "./frontmatter.js";
import { isRecord } from "./json.js";
import { descendingChain, toPosix } from "./paths.js";
import { readJsonFile } from "./settings.js";
import {
  type AgentEntry,
  type ConfigLayer,
  type McpServerEntry,
  type McpServerState,
  type SettingsEntry,
  type ShadowedBy,
  type SkillEntry,
  type SkillSource,
} from "./types.js";

/* -------------------------------------------------------------------------- */
/* frontmatter helpers                                                         */
/* -------------------------------------------------------------------------- */

/** The raw text between the opening and closing `---` fences, if any. */
function frontmatterBody(content: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  return match?.[1] ?? "";
}

function splitInlineList(value: string): string[] {
  let text = value.trim();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  return text
    .split(/[,\n]/)
    .flatMap((part) => part.split(/\s+/))
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter((part) => part.length > 0);
}

/**
 * A frontmatter field that may be written either inline
 * (`tools: Read, Grep` or `tools: [Read, Grep]`) or as a YAML block list:
 *
 * ```yaml
 * tools:
 *   - Read
 *   - Grep
 * ```
 *
 * `parseFrontmatter` only keeps scalars, so block lists are read here.
 */
function listField(body: string, key: string): string[] | undefined {
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^\s/.test(line)) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    if (line.slice(0, separator).trim() !== key) continue;

    const inline = line.slice(separator + 1).trim();
    if (inline.length > 0) {
      const items = splitInlineList(inline);
      return items.length > 0 ? items : undefined;
    }

    const items: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j]!;
      if (next.trim().length === 0) continue;
      const item = /^\s+-\s*(.*)$/.exec(next);
      if (!item) break;
      items.push(...splitInlineList(item[1] ?? ""));
    }
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

function boolField(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const text = value.trim().toLowerCase();
  if (text === "true" || text === "yes") return true;
  if (text === "false" || text === "no") return false;
  return undefined;
}

function numberField(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

/* -------------------------------------------------------------------------- */
/* skills                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Precedence when two skills share a short name. Docs (/skills): "Enterprise
 * over personal, and personal over project", and any of those override bundled
 * skills. Plugin and nested skills are namespaced, so they never collide.
 */
const SKILL_PRECEDENCE: Record<SkillSource, number> = {
  personal: 2,
  synced: 2,
  project: 1,
  nested: 0,
  plugin: 0,
};

interface SkillScan {
  /** Directory holding `<name>/SKILL.md`. */
  root: string;
  layer: ConfigLayer;
  source: SkillSource;
  /** Prefix for the display name, e.g. `my-plugin:` or `apps/web:`. */
  namespace?: string;
  plugin?: string;
  subdir?: string;
  /** Directory names to skip (e.g. `synced`, handled separately). */
  skip?: readonly string[];
}

async function collectSkillsFrom(
  run: ResolveRun,
  scan: SkillScan,
): Promise<SkillEntry[]> {
  const out: SkillEntry[] = [];
  const dirs = (await listDir(run, scan.root))
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .filter((name) => !(scan.skip ?? []).includes(name))
    .sort();

  for (const dirName of dirs) {
    const path = run.p.join(scan.root, dirName, "SKILL.md");
    const content = await readText(run, path);
    if (content === null) continue;
    const frontmatter = parseFrontmatter(content);
    const label = frontmatter["name"] ?? dirName;
    const entry: SkillEntry = {
      path,
      layer: scan.layer,
      // Plugin names are not doubled when the frontmatter already carries the
      // prefix (docs: /skills, plugin naming).
      name:
        scan.namespace && !label.startsWith(scan.namespace)
          ? `${scan.namespace}${label}`
          : label,
      shortName: dirName,
      source: scan.source,
    };
    const description = frontmatter["description"];
    if (description) entry.description = description;
    const allowedTools = listField(frontmatterBody(content), "allowed-tools");
    if (allowedTools) entry.allowedTools = allowedTools;
    if (scan.plugin) entry.plugin = scan.plugin;
    if (scan.subdir) entry.subdir = scan.subdir;
    out.push(entry);
  }
  return out;
}

/** `~/.claude/skills/synced/<id>/<name>/SKILL.md`, synced from claude.ai. */
async function collectSyncedSkills(
  run: ResolveRun,
  skillsDir: string,
): Promise<SkillEntry[]> {
  const syncedRoot = run.p.join(skillsDir, "synced");
  const buckets = (await listDir(run, syncedRoot))
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .sort();

  const out: SkillEntry[] = [];
  for (const bucket of buckets) {
    out.push(
      ...(await collectSkillsFrom(run, {
        root: run.p.join(syncedRoot, bucket),
        layer: "user",
        source: "synced",
      })),
    );
  }
  return out;
}

/** How deep under `~/.claude/plugins` to look for a `skills` directory. */
const PLUGIN_SCAN_DEPTH = 6;

/**
 * Plugin skills. On this machine the installed marketplaces look like
 * `~/.claude/plugins/marketplaces/<marketplace>/plugins/<plugin>/skills/<name>/SKILL.md`
 * (and `.../external_plugins/<plugin>/skills/...`), so rather than hard-coding
 * that shape we walk for any directory named `skills` and take the plugin name
 * from its parent directory.
 */
async function collectPluginSkills(run: ResolveRun): Promise<SkillEntry[]> {
  const root = run.p.join(userClaudeDir(run), "plugins");
  const out: SkillEntry[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > PLUGIN_SCAN_DEPTH) return;
    const entries = (await listDir(run, dir))
      .filter((entry) => entry.isDirectory)
      .map((entry) => entry.name)
      .sort();

    for (const name of entries) {
      const child = run.p.join(dir, name);
      if (name === "skills" && dir !== root) {
        const plugin = run.p.basename(dir);
        out.push(
          ...(await collectSkillsFrom(run, {
            root: child,
            layer: "user",
            source: "plugin",
            namespace: `${plugin}:`,
            plugin,
          })),
        );
        continue;
      }
      await walk(child, depth + 1);
    }
  };

  await walk(root, 0);
  return out;
}

/**
 * `<subdir>/.claude/skills/<name>/SKILL.md` for every directory between the
 * project root and the target. Docs (/skills): skills below where the session
 * started load the first time Claude reads or edits a file there, and are
 * addressed directory-qualified (`apps/web:deploy`).
 */
async function collectNestedSkills(run: ResolveRun): Promise<SkillEntry[]> {
  const targetDir = run.targetKind === "directory" ? run.file : run.p.dirname(run.file);
  const chain = descendingChain(run.p, run.folder, targetDir);
  const out: SkillEntry[] = [];

  for (const dir of chain) {
    const subdir = toPosix(run.p.relative(run.folder, dir));
    if (subdir.length === 0 || subdir.startsWith("..")) continue;
    out.push(
      ...(await collectSkillsFrom(run, {
        root: run.p.join(dir, ".claude", "skills"),
        layer: "directory",
        source: "nested",
        namespace: `${subdir}:`,
        subdir,
      })),
    );
  }
  return out;
}

/**
 * Marks every entry a higher-precedence namesake shadows, keyed by `keyOf`.
 * The loser stays in the list with `shadowedBy` pointing at the winner, the
 * way an overridden permission rule does.
 */
function markShadowed<T extends { path: string; layer: ConfigLayer }>(
  entries: T[],
  keyOf: (entry: T) => string | undefined,
  rankOf: (entry: T) => number,
  assign: (entry: T, shadowedBy: ShadowedBy) => void,
): void {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (key === undefined) continue;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    let winner = group[0]!;
    for (const candidate of group.slice(1)) {
      if (rankOf(candidate) > rankOf(winner)) winner = candidate;
    }
    for (const entry of group) {
      if (entry === winner) continue;
      if (rankOf(entry) === rankOf(winner)) continue;
      assign(entry, { path: winner.path, layer: winner.layer });
    }
  }
}

/**
 * Skills from `~/.claude/skills` (including `synced/`), the project's
 * `.claude/skills`, every `.claude/skills` between the project root and the
 * target, and plugins under `~/.claude/plugins`.
 */
export async function collectSkills(run: ResolveRun): Promise<SkillEntry[]> {
  const userSkills = run.p.join(userClaudeDir(run), "skills");
  const out: SkillEntry[] = [
    ...(await collectSkillsFrom(run, {
      root: userSkills,
      layer: "user",
      source: "personal",
      skip: ["synced"],
    })),
    ...(await collectSyncedSkills(run, userSkills)),
    ...(await collectSkillsFrom(run, {
      root: run.p.join(projectClaudeDir(run), "skills"),
      layer: "project",
      source: "project",
    })),
    ...(await collectNestedSkills(run)),
    ...(await collectPluginSkills(run)),
  ];

  markShadowed(
    out,
    // Namespaced skills never collide, so they take no part in shadowing.
    (entry) =>
      entry.source === "plugin" || entry.source === "nested"
        ? undefined
        : entry.shortName,
    (entry) => SKILL_PRECEDENCE[entry.source],
    (entry, shadowedBy) => {
      entry.shadowedBy = shadowedBy;
    },
  );

  return out;
}

/* -------------------------------------------------------------------------- */
/* subagents                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Docs (/sub-agents): "When multiple subagents share the same name, Claude
 * Code uses the one from the higher-priority location", and the priority list
 * puts `.claude/agents/` (project) above `~/.claude/agents/` (user), above a
 * plugin's `agents/`. So the project subagent wins and the user one is shadowed.
 */
const AGENT_PRECEDENCE: Partial<Record<ConfigLayer, number>> = {
  managed: 4,
  directory: 3,
  local: 2,
  project: 2,
  user: 1,
};

async function collectAgentsFrom(
  run: ResolveRun,
  root: string,
  layer: ConfigLayer,
): Promise<AgentEntry[]> {
  const out: AgentEntry[] = [];
  const files = (await listDir(run, root))
    .filter((entry) => !entry.isDirectory && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  for (const fileName of files) {
    const path = run.p.join(root, fileName);
    const content = await readText(run, path);
    if (content === null) continue;
    const frontmatter = parseFrontmatter(content);
    const body = frontmatterBody(content);
    const entry: AgentEntry = {
      path,
      layer,
      name: frontmatter["name"] ?? fileName.replace(/\.md$/i, ""),
    };

    const description = frontmatter["description"];
    if (description) entry.description = description;

    const tools = listField(body, "tools");
    if (tools) entry.tools = tools;
    const disallowedTools = listField(body, "disallowedTools");
    if (disallowedTools) entry.disallowedTools = disallowedTools;
    const skills = listField(body, "skills");
    if (skills) entry.skills = skills;
    const mcpServers = listField(body, "mcpServers");
    if (mcpServers) entry.mcpServers = mcpServers;

    for (const key of ["model", "permissionMode", "memory", "effort", "isolation", "color"] as const) {
      const value = frontmatter[key];
      if (value) entry[key] = value;
    }

    const maxTurns = numberField(frontmatter["maxTurns"]);
    if (maxTurns !== undefined) entry.maxTurns = maxTurns;
    const background = boolField(frontmatter["background"]);
    if (background !== undefined) entry.background = background;

    out.push(entry);
  }
  return out;
}

/** Subagents from `~/.claude/agents` then `<folder>/.claude/agents`. */
export async function collectAgents(run: ResolveRun): Promise<AgentEntry[]> {
  const out = [
    ...(await collectAgentsFrom(run, run.p.join(userClaudeDir(run), "agents"), "user")),
    ...(await collectAgentsFrom(
      run,
      run.p.join(projectClaudeDir(run), "agents"),
      "project",
    )),
  ];

  markShadowed(
    out,
    (entry) => entry.name,
    (entry) => AGENT_PRECEDENCE[entry.layer] ?? 0,
    (entry, shadowedBy) => {
      entry.shadowedBy = shadowedBy;
    },
  );

  return out;
}

/* -------------------------------------------------------------------------- */
/* MCP servers                                                                 */
/* -------------------------------------------------------------------------- */

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
    else if (typeof item === "number" || typeof item === "boolean") out[key] = String(item);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

interface Approval {
  state: McpServerState;
  reason: string;
  stateSource?: string;
  stateKey?: string;
}

/**
 * Approval state of a `.mcp.json` server.
 *
 * Docs (/mcp): `.mcp.json` servers need approval. `enableAllProjectMcpServers`
 * approves every one of them, `enabledMcpjsonServers` approves named ones, and
 * `disabledMcpjsonServers` rejects named ones. All three are valid in any
 * settings file, and a rejection anywhere wins over any approval.
 */
function mcpJsonApproval(name: string, settings: SettingsEntry[]): Approval {
  // `settings` comes lowest-precedence first; report the most specific file
  // that mentions the server, so scan from the highest precedence down.
  const layered = [...settings].reverse();

  for (const entry of layered) {
    if (stringList(entry.values["disabledMcpjsonServers"]).includes(name)) {
      return {
        state: "disabled",
        reason: `disabled by disabledMcpjsonServers in ${entry.path}`,
        stateSource: entry.path,
        stateKey: "disabledMcpjsonServers",
      };
    }
  }

  for (const entry of layered) {
    if (stringList(entry.values["enabledMcpjsonServers"]).includes(name)) {
      return {
        state: "enabled",
        reason: `approved by enabledMcpjsonServers in ${entry.path}`,
        stateSource: entry.path,
        stateKey: "enabledMcpjsonServers",
      };
    }
  }

  for (const entry of layered) {
    if (entry.values["enableAllProjectMcpServers"] === true) {
      return {
        state: "enabled",
        reason: `approved by enableAllProjectMcpServers in ${entry.path}`,
        stateSource: entry.path,
        stateKey: "enableAllProjectMcpServers",
      };
    }
  }

  return {
    state: "unapproved",
    reason:
      "not approved in any settings file (no enableAllProjectMcpServers, not in enabledMcpjsonServers); Claude Code would prompt on first use",
  };
}

function readServerMap(
  value: unknown,
  path: string,
  layer: ConfigLayer,
  approvalOf: (name: string) => Approval,
): McpServerEntry[] {
  if (!isRecord(value)) return [];
  const out: McpServerEntry[] = [];
  for (const name of Object.keys(value).sort()) {
    const config = value[name];
    const approval = approvalOf(name);
    const entry: McpServerEntry = {
      path,
      layer,
      name,
      transport: "unknown",
      state: approval.state,
      reason: approval.reason,
    };
    if (approval.stateSource) entry.stateSource = approval.stateSource;
    if (approval.stateKey) entry.stateKey = approval.stateKey;

    if (isRecord(config)) {
      const type = config["type"];
      const url = config["url"];
      const command = config["command"];
      if (type === "http" || type === "sse" || type === "stdio") entry.type = type;
      if (type === "http" || type === "sse") entry.transport = type;
      else if (typeof url === "string") entry.transport = "http";
      else if (type === "stdio" || typeof command === "string") entry.transport = "stdio";

      if (typeof url === "string") {
        entry.target = url;
      } else if (typeof command === "string") {
        const args = Array.isArray(config["args"])
          ? config["args"].filter((a): a is string => typeof a === "string")
          : [];
        entry.target = [command, ...args].join(" ");
      }

      const env = stringMap(config["env"]);
      if (env) entry.env = env;
      const headers = stringMap(config["headers"]);
      if (headers) entry.headers = headers;
    }
    out.push(entry);
  }
  return out;
}

/**
 * MCP servers from `~/.claude.json` (user + per-project) and `<folder>/.mcp.json`.
 *
 * User-scoped servers are already the user's own choice, so they are always
 * enabled; `.mcp.json` servers carry the approval state the settings files give
 * them.
 */
export async function collectMcpServers(
  run: ResolveRun,
  settings: SettingsEntry[] = [],
): Promise<McpServerEntry[]> {
  const out: McpServerEntry[] = [];

  const userConfigPath = run.p.join(run.homeDir, ".claude.json");
  const userConfig = await readJsonFile(run, userConfigPath);
  const userApproval = (path: string): Approval => ({
    state: "enabled",
    reason: `declared in ${path}; user-scoped servers need no approval`,
    stateSource: path,
  });

  if (userConfig) {
    out.push(
      ...readServerMap(userConfig["mcpServers"], userConfigPath, "user", () =>
        userApproval(userConfigPath),
      ),
    );
  }

  const projectConfigPath = run.p.join(run.folder, ".mcp.json");
  const projectConfig = await readJsonFile(run, projectConfigPath);
  if (projectConfig) {
    out.push(
      ...readServerMap(
        projectConfig["mcpServers"],
        projectConfigPath,
        "project",
        (name) => mcpJsonApproval(name, settings),
      ),
    );
  }

  if (userConfig) {
    const projects = userConfig["projects"];
    if (isRecord(projects)) {
      const scoped = projects[run.folder];
      if (isRecord(scoped)) {
        out.push(
          ...readServerMap(scoped["mcpServers"], userConfigPath, "local", () =>
            userApproval(userConfigPath),
          ),
        );
      }
    }
  }

  return out;
}
