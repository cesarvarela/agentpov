import {
  listDir,
  projectDirsUpToGitRoot,
  readText,
  userClaudeDir,
  type ResolveRun,
} from "./context.js";
import { parseFrontmatter } from "./frontmatter.js";
import { asStringArray, isRecord } from "./json.js";
import { descendingChain, toPosix } from "./paths.js";
import {
  enabledPlugins,
  pluginComponentPaths,
  strictPluginOnlyLock,
  type LoadedPlugin,
} from "./plugins.js";
import { settingsByPriority } from "./settings.js";
import {
  type AgentEntry,
  type ConfigLayer,
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

export function boolField(value: string | undefined): boolean | undefined {
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

/** Entries of `dir` sorted by name, so results don't depend on read order. */
async function sortedEntries(
  run: ResolveRun,
  dir: string,
): Promise<{ name: string; isDirectory: boolean }[]> {
  return [...(await listDir(run, dir))].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

/** Whether `path` is a directory (the reader lists it). */
async function isDirectory(run: ResolveRun, path: string): Promise<boolean> {
  return (await run.fs.readDir(path)) !== null;
}

/* -------------------------------------------------------------------------- */
/* shadowing                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Marks every entry a higher-precedence namesake shadows, keyed by `keyOf`.
 * The loser stays in the list with `shadowedBy` pointing at the winner, the
 * way an overridden permission rule does. Entries of equal rank don't shadow
 * each other.
 */
export function markShadowed<T extends { path: string; layer: ConfigLayer }>(
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

/* -------------------------------------------------------------------------- */
/* skills                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Precedence when two skills share a short name. Docs (/skills): "Enterprise
 * over personal, and personal over project", and any of those override bundled
 * skills. Plugin and nested skills are namespaced, so they never collide.
 */
const SKILL_PRECEDENCE: Record<SkillSource, number> = {
  managed: 3,
  personal: 2,
  synced: 2,
  project: 1,
  // Docs (/skills): a skill wins over a legacy command of the same name.
  command: 0,
  nested: 0,
  plugin: 0,
};

/**
 * Docs (/skills, "Reserved name `synced`"): a skill folder named `synced`, in
 * any capitalization, is skipped in the enterprise, personal and project
 * locations.
 */
const RESERVED_SKILL_DIRS = ["synced"];

interface SkillScan {
  /** Directory holding `<name>/SKILL.md`. */
  root: string;
  layer: ConfigLayer;
  source: SkillSource;
  /** Prefix for the display name, e.g. `my-plugin:` or `apps/web:`. */
  namespace?: string;
  plugin?: string;
  subdir?: string;
  /** Directory names to skip, compared case-insensitively. */
  skip?: readonly string[];
}

async function collectSkillsFrom(
  run: ResolveRun,
  scan: SkillScan,
): Promise<SkillEntry[]> {
  const out: SkillEntry[] = [];
  const skip = (scan.skip ?? []).map((name) => name.toLowerCase());
  const dirs = (await listDir(run, scan.root))
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .filter((name) => !skip.includes(name.toLowerCase()))
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

/**
 * Every synced skill is namespaced `anthropic-skills:<name>`. Checked against
 * Claude Code 2.1.277: `/context` lists them as `anthropic-skills:docs`,
 * `anthropic-skills:pdf`, and the docs (/skills) note a synced skill stays
 * callable as `/anthropic-skills:<name>` when it loses its short name.
 */
const SYNCED_NAMESPACE = "anthropic-skills:";

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
        namespace: SYNCED_NAMESPACE,
      })),
    );
  }
  return out;
}

/**
 * Skills from enabled plugins, namespaced `<plugin>:<skill>`. Docs
 * (/plugins/manifest-reference): the manifest `skills` paths **add** to the
 * default `skills/` directory. Checked against Claude Code 2.1.277: only
 * installed plugins contribute, never every plugin a marketplace checkout ships.
 */
async function collectPluginSkills(
  run: ResolveRun,
  plugins: LoadedPlugin[],
): Promise<SkillEntry[]> {
  const out: SkillEntry[] = [];
  const seen = new Set<string>();
  for (const plugin of enabledPlugins(plugins)) {
    const { name } = plugin.entry;
    for (const root of pluginComponentPaths(run, plugin, "skills", "skills", "adds")) {
      for (const skill of await collectSkillsFrom(run, {
        root,
        layer: plugin.entry.layer,
        source: "plugin",
        namespace: `${name}:`,
        plugin: name,
      })) {
        if (seen.has(skill.path)) continue;
        seen.add(skill.path);
        out.push(skill);
      }
    }
  }
  return out;
}

interface CommandScan {
  layer: ConfigLayer;
  /** `<plugin>:` for plugin commands. */
  namespace?: string;
  plugin?: string;
}

/**
 * One legacy command. Docs (/skills): a command file takes the same
 * frontmatter as a skill except `name` and `paths`, so its name always comes
 * from the file (or the manifest key, for a plugin's object-map command).
 */
function commandEntry(
  scan: CommandScan,
  path: string,
  shortName: string,
  content: string,
): SkillEntry {
  const skill: SkillEntry = {
    path,
    layer: scan.layer,
    name: `${scan.namespace ?? ""}${shortName}`,
    shortName,
    source: "command",
  };
  const description = parseFrontmatter(content)["description"];
  if (description) skill.description = description;
  const allowedTools = listField(frontmatterBody(content), "allowed-tools");
  if (allowedTools) skill.allowedTools = allowedTools;
  if (scan.plugin) skill.plugin = scan.plugin;
  return skill;
}

/**
 * Legacy `commands/**\/*.md` under `root`. A command is named after its file,
 * prefixed by its subfolders: `commands/sub/deep.md` is `sub:deep` (Claude Code
 * 2.1.280; docs: /skills, "How a skill gets its command name").
 */
async function collectCommandsFrom(
  run: ResolveRun,
  root: string,
  scan: CommandScan,
): Promise<SkillEntry[]> {
  const out: SkillEntry[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await sortedEntries(run, dir)) {
      const path = run.p.join(dir, entry.name);
      if (entry.isDirectory) {
        await walk(path, `${prefix}${entry.name}:`);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      const content = await readText(run, path);
      if (content === null) continue;
      out.push(commandEntry(scan, path, `${prefix}${entry.name.replace(/\.md$/i, "")}`, content));
    }
  };
  await walk(root, "");
  return out;
}

/**
 * Commands from enabled plugins, namespaced `<plugin>:<name>`; a subfolder of
 * `commands/` adds a segment (`commands/db/migrate.md` is
 * `<plugin>:db:migrate`). Docs (/plugins/components#commands,
 * /plugins/manifest-reference#commands): the manifest `commands` key
 * **replaces** the default `commands/` scan and takes a path (a `.md` file or
 * a directory), an array of paths, or an object map of command name to
 * `{ source }` (a file) or `{ content }` (inline Markdown), with optional
 * `description` and `allowedTools`. An entry with both or neither of
 * `source`/`content` fails validation, so it is skipped.
 */
async function collectPluginCommands(
  run: ResolveRun,
  plugins: LoadedPlugin[],
): Promise<SkillEntry[]> {
  const out: SkillEntry[] = [];
  for (const plugin of enabledPlugins(plugins)) {
    const root = plugin.entry.root!;
    const scan: CommandScan = {
      layer: plugin.entry.layer,
      namespace: `${plugin.entry.name}:`,
      plugin: plugin.entry.name,
    };
    const seen = new Set<string>();
    const add = (skill: SkillEntry): void => {
      if (seen.has(skill.name)) return;
      seen.add(skill.name);
      out.push(skill);
    };

    const declared = plugin.manifest?.["commands"];
    if (isRecord(declared)) {
      const manifestPath = run.p.join(root, ".claude-plugin", "plugin.json");
      for (const [key, value] of Object.entries(declared)) {
        if (!isRecord(value)) continue;
        const source = typeof value["source"] === "string" ? value["source"] : undefined;
        const inline = typeof value["content"] === "string" ? value["content"] : undefined;
        if ((source === undefined) === (inline === undefined)) continue;
        const path = source !== undefined ? run.p.resolve(root, source) : manifestPath;
        const content = source !== undefined ? await readText(run, path) : inline!;
        if (content === null) continue;
        const skill = commandEntry(scan, path, key, content);
        if (typeof value["description"] === "string" && value["description"].length > 0) {
          skill.description = value["description"];
        }
        const allowedTools = asStringArray(value["allowedTools"]);
        if (allowedTools.length > 0) skill.allowedTools = allowedTools;
        add(skill);
      }
      continue;
    }

    for (const path of pluginComponentPaths(run, plugin, "commands", "commands", "replaces")) {
      if (await isDirectory(run, path)) {
        for (const skill of await collectCommandsFrom(run, path, scan)) add(skill);
        continue;
      }
      if (!path.toLowerCase().endsWith(".md")) continue;
      const content = await readText(run, path);
      if (content === null) continue;
      add(commandEntry(scan, path, run.p.basename(path).replace(/\.md$/i, ""), content));
    }
  }
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
 * Sources a `strictPluginOnlyCustomization` skills lock stops loading. Docs
 * (/settings-reference#strictpluginonlycustomization-skills): `~/.claude/skills/`,
 * `.claude/skills/`, `~/.claude/commands/`, `.claude/commands/`, `--add-dir`
 * skills and claude.ai-synced skills; plugin, bundled and managed skills keep
 * loading. Nested `.claude/skills/` count as project skills here.
 */
const STRICT_BLOCKED_SKILLS: ReadonlySet<SkillSource> = new Set<SkillSource>([
  "personal",
  "synced",
  "project",
  "nested",
  "command",
]);

/**
 * `skillOverrides` merged across settings files: for each skill name, the
 * highest-precedence file that sets it decides (docs: /settings-reference
 * #skilloverrides, scope "Any file"; /skills#override-skill-visibility-from-settings).
 */
function skillOverrides(settings: SettingsEntry[]): Map<string, { state: string; path: string }> {
  const out = new Map<string, { state: string; path: string }>();
  for (const entry of settingsByPriority(settings)) {
    const overrides = entry.values["skillOverrides"];
    if (!isRecord(overrides)) continue;
    for (const [name, state] of Object.entries(overrides)) {
      if (typeof state !== "string" || out.has(name)) continue;
      out.set(name, { state, path: entry.path });
    }
  }
  return out;
}

/** Marks the skills a managed `strictPluginOnlyCustomization` skills lock keeps out. */
function applyStrictSkillLock(skills: SkillEntry[], settings: SettingsEntry[]): void {
  const strict = strictPluginOnlyLock(settings, "skills");
  if (strict) {
    for (const skill of skills) {
      if (skill.plugin !== undefined || !STRICT_BLOCKED_SKILLS.has(skill.source)) continue;
      skill.disabled = `not loaded: strictPluginOnlyCustomization in ${strict.path} allows only plugin, managed and bundled skills`;
    }
  }
}

/**
 * Marks the skills a `skillOverrides` entry turns `"off"`.
 *
 * `skillOverrides` doesn't touch plugin skills (docs: "Plugin skills are not
 * affected by `skillOverrides`"). An entry matches a skill's invocable name
 * (`shortName`) or its display name. Only `"off"` hides a skill from both
 * Claude and the `/` menu; `name-only` and `user-invocable-only` keep it
 * callable, so they are left alone here.
 */
function applySkillOverrides(skills: SkillEntry[], settings: SettingsEntry[]): void {
  const overrides = skillOverrides(settings);
  if (overrides.size === 0) return;
  for (const skill of skills) {
    if (skill.disabled || skill.plugin !== undefined || skill.source === "plugin") continue;
    const override = overrides.get(skill.shortName) ?? overrides.get(skill.name);
    if (override?.state !== "off") continue;
    skill.disabled = `turned off by skillOverrides in ${override.path}`;
  }
}

/**
 * Skills from the managed policy directory, `~/.claude/skills` (including
 * `synced/`), `.claude/skills` in the project folder and every folder above it
 * up to the git root, every `.claude/skills` between the project root and the
 * target, enabled plugins' skills and commands, and legacy `.claude/commands`
 * from the same places as user and project skills.
 *
 * Docs (/skills, "Where skills live"): enterprise skills live in
 * `.claude/skills/<name>/SKILL.md` inside the managed settings directory.
 */
export async function collectSkills(
  run: ResolveRun,
  plugins: LoadedPlugin[] = [],
  settings: SettingsEntry[] = [],
): Promise<SkillEntry[]> {
  const userSkills = run.p.join(userClaudeDir(run), "skills");
  const projectDirs = projectDirsUpToGitRoot(run);
  const out: SkillEntry[] = [
    ...(await collectSkillsFrom(run, {
      root: run.p.join(run.managedDir, ".claude", "skills"),
      layer: "managed",
      source: "managed",
      skip: RESERVED_SKILL_DIRS,
    })),
    ...(await collectSkillsFrom(run, {
      root: userSkills,
      layer: "user",
      source: "personal",
      skip: RESERVED_SKILL_DIRS,
    })),
    ...(await collectSyncedSkills(run, userSkills)),
  ];
  for (const dir of projectDirs) {
    out.push(
      ...(await collectSkillsFrom(run, {
        root: run.p.join(dir, ".claude", "skills"),
        layer: "project",
        source: "project",
        skip: RESERVED_SKILL_DIRS,
      })),
    );
  }
  out.push(
    ...(await collectNestedSkills(run)),
    ...(await collectPluginSkills(run, plugins)),
    ...(await collectPluginCommands(run, plugins)),
    ...(await collectCommandsFrom(run, run.p.join(userClaudeDir(run), "commands"), {
      layer: "user",
    })),
  );
  for (const dir of projectDirs) {
    out.push(
      ...(await collectCommandsFrom(run, run.p.join(dir, ".claude", "commands"), {
        layer: "project",
      })),
    );
  }

  applyStrictSkillLock(out, settings);

  markShadowed(
    out,
    // Namespaced skills (and plugin commands) never collide, so they take no
    // part in shadowing; neither does a skill policy keeps from loading.
    (entry) =>
      entry.source === "plugin" ||
      entry.source === "nested" ||
      entry.plugin !== undefined ||
      entry.disabled !== undefined
        ? undefined
        : entry.shortName,
    (entry) => SKILL_PRECEDENCE[entry.source],
    (entry, shadowedBy) => {
      entry.shadowedBy = shadowedBy;
    },
  );

  applySkillOverrides(out, settings);

  return out;
}

/* -------------------------------------------------------------------------- */
/* subagents                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Docs (/sub-agents, "Choose the subagent scope"): "When multiple subagents
 * share the same name, Claude Code uses the one from the higher-priority
 * location": managed > `--agents` > `.claude/agents/` (project) >
 * `~/.claude/agents/` (user) > a plugin's `agents/`. Across nested project
 * directories the definition closest to the working directory wins, so a
 * project entry's rank drops with its distance from the folder.
 */
const AGENT_RANK = {
  managed: 1000,
  project: 500,
  user: 100,
  plugin: 0,
} as const;

interface AgentScan {
  root: string;
  layer: ConfigLayer;
  rank: number;
  /** For plugin agents: the plugin name (the namespace). */
  plugin?: string;
  /**
   * Plugin agents only: whether subfolders become name segments. Docs
   * (/plugins/components#organize-agents-in-subfolders): true for the
   * default `agents/` scan; a file listed in the manifest loads without them.
   */
  scoped?: boolean;
}

function agentEntry(
  scan: AgentScan,
  path: string,
  fileName: string,
  prefix: string,
  content: string,
): AgentEntry {
  const frontmatter = parseFrontmatter(content);
  const body = frontmatterBody(content);
  const label = frontmatter["name"] ?? fileName.replace(/\.md$/i, "");
  const entry: AgentEntry = {
    path,
    layer: scan.layer,
    name: scan.plugin ? `${scan.plugin}:${prefix}${label}` : label,
  };

  const description = frontmatter["description"];
  if (description) entry.description = description;

  const tools = listField(body, "tools");
  if (tools) entry.tools = tools;
  const disallowedTools = listField(body, "disallowedTools");
  if (disallowedTools) entry.disallowedTools = disallowedTools;
  const skills = listField(body, "skills");
  if (skills) entry.skills = skills;

  // Docs (/sub-agents, /plugins/components#frontmatter-fields-in-plugin-agents):
  // plugin subagents ignore `permissionMode`, `hooks` and `mcpServers`.
  if (!scan.plugin) {
    const mcpServers = listField(body, "mcpServers");
    if (mcpServers) entry.mcpServers = mcpServers;
    const permissionMode = frontmatter["permissionMode"];
    if (permissionMode) entry.permissionMode = permissionMode;
  }

  for (const key of ["model", "memory", "effort", "isolation", "color"] as const) {
    const value = frontmatter[key];
    if (value) entry[key] = value;
  }

  const maxTurns = numberField(frontmatter["maxTurns"]);
  if (maxTurns !== undefined) entry.maxTurns = maxTurns;
  const background = boolField(frontmatter["background"]);
  if (background !== undefined) entry.background = background;

  if (scan.plugin) entry.plugin = scan.plugin;
  return entry;
}

/**
 * Every `*.md` under `scan.root`, recursively. Docs (/sub-agents): Claude Code
 * scans `.claude/agents/`, `~/.claude/agents/` and plugin `agents/`
 * recursively; the subfolder path is part of the name only for plugin agents.
 */
async function collectAgentsFrom(
  run: ResolveRun,
  scan: AgentScan,
  ranks: Map<AgentEntry, number>,
): Promise<AgentEntry[]> {
  const out: AgentEntry[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await sortedEntries(run, dir);
    for (const entry of entries) {
      if (entry.isDirectory || !entry.name.toLowerCase().endsWith(".md")) continue;
      const path = run.p.join(dir, entry.name);
      const content = await readText(run, path);
      if (content === null) continue;
      const agent = agentEntry(scan, path, entry.name, prefix, content);
      ranks.set(agent, scan.rank);
      out.push(agent);
    }
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      await walk(run.p.join(dir, entry.name), scan.scoped ? `${prefix}${entry.name}:` : prefix);
    }
  };
  await walk(scan.root, "");
  return out;
}

/**
 * Subagents from enabled plugins, named `<plugin>:<subfolders>:<name>`. Docs
 * (/plugins/manifest-reference): the manifest `agents` key **replaces** the
 * default `agents/` scan and lists `.md` files only (directories aren't
 * accepted), each named without subfolders.
 */
async function collectPluginAgents(
  run: ResolveRun,
  plugins: LoadedPlugin[],
  ranks: Map<AgentEntry, number>,
): Promise<AgentEntry[]> {
  const out: AgentEntry[] = [];
  for (const plugin of enabledPlugins(plugins)) {
    const base = {
      layer: plugin.entry.layer,
      rank: AGENT_RANK.plugin,
      plugin: plugin.entry.name,
    };
    const seen = new Set<string>();
    const paths = pluginComponentPaths(run, plugin, "agents", "agents", "replaces");
    const declared = plugin.manifest?.["agents"] !== undefined;
    for (const path of paths) {
      const found: AgentEntry[] = [];
      if (!declared) {
        found.push(...(await collectAgentsFrom(run, { ...base, root: path, scoped: true }, ranks)));
      } else if (path.toLowerCase().endsWith(".md")) {
        const content = await readText(run, path);
        if (content === null) continue;
        const agent = agentEntry({ ...base, root: path }, path, run.p.basename(path), "", content);
        ranks.set(agent, base.rank);
        found.push(agent);
      }
      for (const agent of found) {
        if (seen.has(agent.path)) continue;
        seen.add(agent.path);
        out.push(agent);
      }
    }
  }
  return out;
}

/**
 * Subagents from the managed policy directory (`<managed>/.claude/agents`),
 * `~/.claude/agents`, `.claude/agents` in the project folder and every folder
 * above it up to the git root, and enabled plugins.
 *
 * A managed `strictPluginOnlyCustomization` agents lock stops user and project
 * subagents from loading; plugin, built-in and managed ones keep loading
 * (docs: /settings-reference#strictpluginonlycustomization-agents).
 */
export async function collectAgents(
  run: ResolveRun,
  plugins: LoadedPlugin[] = [],
  settings: SettingsEntry[] = [],
): Promise<AgentEntry[]> {
  const ranks = new Map<AgentEntry, number>();
  const out = [
    ...(await collectAgentsFrom(
      run,
      {
        root: run.p.join(run.managedDir, ".claude", "agents"),
        layer: "managed",
        rank: AGENT_RANK.managed,
      },
      ranks,
    )),
    ...(await collectAgentsFrom(
      run,
      { root: run.p.join(userClaudeDir(run), "agents"), layer: "user", rank: AGENT_RANK.user },
      ranks,
    )),
  ];
  const projectDirs = projectDirsUpToGitRoot(run);
  for (const [index, dir] of projectDirs.entries()) {
    out.push(
      ...(await collectAgentsFrom(
        run,
        {
          root: run.p.join(dir, ".claude", "agents"),
          layer: "project",
          rank: AGENT_RANK.project - index,
        },
        ranks,
      )),
    );
  }
  out.push(...(await collectPluginAgents(run, plugins, ranks)));

  const strict = strictPluginOnlyLock(settings, "agents");
  if (strict) {
    for (const agent of out) {
      if (agent.plugin !== undefined || agent.layer === "managed") continue;
      agent.disabled = `not loaded: strictPluginOnlyCustomization in ${strict.path} allows only plugin, managed and built-in subagents`;
    }
  }

  markShadowed(
    out,
    (entry) => (entry.disabled === undefined ? entry.name : undefined),
    (entry) => ranks.get(entry) ?? 0,
    (entry, shadowedBy) => {
      entry.shadowedBy = shadowedBy;
    },
  );

  return out;
}
