import { listDir, userClaudeDir, type ResolveRun } from "./context.js";
import { isRecord } from "./json.js";
import { readJsonFile, settingsByPriority } from "./settings.js";
import {
  type ConfigLayer,
  type PluginEntry,
  type SettingsEntry,
} from "./types.js";

/** An enabled-or-not plugin plus its parsed manifest, shared by every collector. */
export interface LoadedPlugin {
  entry: PluginEntry;
  /** `.claude-plugin/plugin.json`, when present and valid. */
  manifest?: Record<string, unknown>;
}

/** One install record from `installed_plugins.json`. */
export interface InstallRecord {
  /** `<plugin>@<marketplace>`. */
  key: string;
  name: string;
  marketplace?: string;
  /** Explicit install path, when the record carries one. */
  path?: string;
  version?: string;
  /** `user`, `project` or `local`, when the record says. */
  scope?: string;
  /** For project/local installs: the project the record belongs to. */
  projectPath?: string;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function splitKey(key: string): { name: string; marketplace?: string } {
  const at = key.lastIndexOf("@");
  return at > 0 ? { name: key.slice(0, at), marketplace: key.slice(at + 1) } : { name: key };
}

/**
 * Reads `installed_plugins.json`. Claude Code 2.1.280 writes version 2:
 * `plugins` keyed by `<plugin>@<marketplace>`, each value an array of install
 * records `{ scope, installPath, version, installedAt, lastUpdated, projectPath? }`.
 * Older shapes are still accepted: a single record object, a bare boolean, or
 * a marketplace key holding an array of plugin names.
 */
export function parseInstalledPlugins(value: unknown): InstallRecord[] {
  const plugins = isRecord(value) ? value["plugins"] : undefined;
  if (!isRecord(plugins)) return [];

  const out: InstallRecord[] = [];
  for (const [key, entry] of Object.entries(plugins)) {
    if (entry === false) continue;
    const records = Array.isArray(entry) ? entry : [entry];
    for (const record of records) {
      if (typeof record === "string") {
        // Old shape: `{ "<marketplace>": ["<plugin>", ...] }`.
        out.push({ key: `${record}@${key}`, name: record, marketplace: key });
        continue;
      }
      const parsed: InstallRecord = { key, ...splitKey(key) };
      if (isRecord(record)) {
        if (record["enabled"] === false) continue;
        const path = firstString(record, ["installPath", "path", "installLocation", "installedPath"]);
        if (path) parsed.path = path;
        const version = firstString(record, ["version"]);
        if (version) parsed.version = version;
        const scope = firstString(record, ["scope"]);
        if (scope) parsed.scope = scope;
        const projectPath = firstString(record, ["projectPath"]);
        if (projectPath) parsed.projectPath = projectPath;
      }
      out.push(parsed);
    }
  }
  return out;
}

export interface EnabledDecision {
  value: boolean;
  path: string;
  layer: ConfigLayer;
}

/**
 * `enabledPlugins` for one plugin id: the highest-precedence settings file
 * that mentions the id decides (docs: /plugins/loading, "Find where a plugin
 * is enabled"): managed > local > project > user. Managed `true`
 * force-enables and managed `false` blocks.
 */
export function enabledPluginsSetting(
  id: string,
  settings: SettingsEntry[],
): EnabledDecision | undefined {
  for (const entry of settingsByPriority(settings)) {
    const enabled = entry.values["enabledPlugins"];
    if (!isRecord(enabled)) continue;
    const value = enabled[id];
    if (typeof value === "boolean") return { value, path: entry.path, layer: entry.layer };
  }
  return undefined;
}

/** Every plugin id any settings file mentions under `enabledPlugins`. */
function idsFromSettings(settings: SettingsEntry[]): string[] {
  const ids = new Set<string>();
  for (const entry of settings) {
    const enabled = entry.values["enabledPlugins"];
    if (!isRecord(enabled)) continue;
    for (const id of Object.keys(enabled)) ids.add(id);
  }
  return [...ids].sort();
}

async function subdirectories(run: ResolveRun, dir: string): Promise<string[]> {
  return (await listDir(run, dir))
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .sort();
}

async function exists(run: ResolveRun, dir: string): Promise<boolean> {
  return (await run.fs.readDir(dir)) !== null;
}

/** Newest-looking version directory first (numeric-aware). */
function byVersionDescending(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true });
}

/**
 * A relative-path plugin in a marketplace added from a local directory loads
 * in place from the marketplace folder, not from its cache copy (docs:
 * /plugins/loading, "In-place and copied plugins"). Reads the marketplace's
 * `source` from `known_marketplaces.json` and the plugin's `source` from that
 * directory's `.claude-plugin/marketplace.json`.
 */
async function inPlacePluginRoot(
  run: ResolveRun,
  pluginsDir: string,
  record: InstallRecord,
): Promise<string | undefined> {
  if (!record.marketplace) return undefined;
  const known = await readJsonFile(run, run.p.join(pluginsDir, "known_marketplaces.json"));
  const marketplace = known?.[record.marketplace];
  const source = isRecord(marketplace) ? marketplace["source"] : undefined;
  if (!isRecord(source) || source["source"] !== "directory") return undefined;
  const dir = source["path"];
  if (typeof dir !== "string") return undefined;

  const listing = await readJsonFile(run, run.p.join(dir, ".claude-plugin", "marketplace.json"));
  const plugins = listing?.["plugins"];
  if (!Array.isArray(plugins)) return undefined;
  for (const plugin of plugins) {
    if (!isRecord(plugin) || plugin["name"] !== record.name) continue;
    const pluginSource = plugin["source"];
    if (typeof pluginSource !== "string" || !pluginSource.startsWith("./")) return undefined;
    const root = run.p.resolve(dir, pluginSource);
    return (await exists(run, root)) ? root : undefined;
  }
  return undefined;
}

/**
 * Where a marketplace plugin's files live: in place for a local-directory
 * marketplace, else the install record's own path when it exists on disk,
 * else the newest `cache/<marketplace>/<plugin>/<version>`, else the
 * marketplace checkout (`marketplaces/<marketplace>/{plugins,external_plugins}/<plugin>`).
 */
async function marketplacePluginRoot(
  run: ResolveRun,
  pluginsDir: string,
  record: InstallRecord,
): Promise<string | undefined> {
  const inPlace = await inPlacePluginRoot(run, pluginsDir, record);
  if (inPlace) return inPlace;
  if (record.path && (await exists(run, record.path))) return record.path;

  const cacheDir = run.p.join(pluginsDir, "cache");
  const marketplacesDir = run.p.join(pluginsDir, "marketplaces");
  const marketplaces = record.marketplace
    ? [record.marketplace]
    : [
        ...new Set([
          ...(await subdirectories(run, marketplacesDir)),
          ...(await subdirectories(run, cacheDir)),
        ]),
      ].sort();

  for (const marketplace of marketplaces) {
    const cached = run.p.join(cacheDir, marketplace, record.name);
    const versions = (await subdirectories(run, cached)).sort(byVersionDescending);
    if (record.version && versions.includes(record.version)) {
      return run.p.join(cached, record.version);
    }
    if (versions.length > 0) return run.p.join(cached, versions[0]!);
    for (const subdir of ["plugins", "external_plugins"]) {
      const checkout = run.p.join(marketplacesDir, marketplace, subdir, record.name);
      if (await exists(run, checkout)) return checkout;
    }
  }
  return undefined;
}

async function readManifest(
  run: ResolveRun,
  root: string,
): Promise<Record<string, unknown> | undefined> {
  return readJsonFile(run, run.p.join(root, ".claude-plugin", "plugin.json"));
}

function manifestString(
  manifest: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = manifest?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Decides `enabled` for a plugin that is on disk: a settings entry for its id
 * wins; with none, the manifest's `defaultEnabled` (default true).
 */
function decide(
  id: string,
  manifest: Record<string, unknown> | undefined,
  settings: SettingsEntry[],
): Pick<PluginEntry, "enabled" | "reason" | "stateSource"> {
  const setting = enabledPluginsSetting(id, settings);
  if (setting) {
    const verb = setting.value ? "enabled" : "disabled";
    const forced = setting.layer === "managed" ? " (managed: nothing overrides it)" : "";
    return {
      enabled: setting.value,
      reason: `${verb} by enabledPlugins in ${setting.path}${forced}`,
      stateSource: setting.path,
    };
  }
  if (manifest?.["defaultEnabled"] === false) {
    return { enabled: false, reason: "off by default (manifest defaultEnabled: false)" };
  }
  return { enabled: true, reason: "on by default (no enabledPlugins entry)" };
}

/** Id suffixes that aren't marketplaces (docs: /plugins/loading, reserved origins). */
const NON_MARKETPLACE_ORIGINS = new Set(["skills-dir", "synced", "inline", "builtin"]);

/** Marketplace plugins: `installed_plugins.json` plus ids only settings mention. */
async function marketplacePlugins(
  run: ResolveRun,
  settings: SettingsEntry[],
): Promise<LoadedPlugin[]> {
  const pluginsDir = run.p.join(userClaudeDir(run), "plugins");
  const manifestPath = run.p.join(pluginsDir, "installed_plugins.json");
  const records = parseInstalledPlugins(await readJsonFile(run, manifestPath));

  // One entry per id. A project/local install recorded for another project
  // doesn't make the plugin available here.
  const byId = new Map<string, InstallRecord>();
  for (const record of records) {
    const elsewhere =
      record.projectPath !== undefined &&
      record.projectPath !== run.folder &&
      record.projectPath !== run.repoRoot;
    if (!elsewhere) byId.set(record.key, record);
  }
  const installedIds = new Set(byId.keys());
  for (const id of idsFromSettings(settings)) {
    const { name, marketplace } = splitKey(id);
    if (marketplace === undefined || NON_MARKETPLACE_ORIGINS.has(marketplace)) continue;
    if (!byId.has(id)) byId.set(id, { key: id, name, marketplace });
  }

  const out: LoadedPlugin[] = [];
  for (const record of [...byId.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    const root = await marketplacePluginRoot(run, pluginsDir, record);
    const manifest = root ? await readManifest(run, root) : undefined;
    const installed = installedIds.has(record.key);
    const entry: PluginEntry = {
      path: installed ? manifestPath : root ? run.p.join(root, ".claude-plugin", "plugin.json") : manifestPath,
      layer: "user",
      id: record.key,
      name: manifestString(manifest, "name") ?? record.name,
      origin: "marketplace",
      ...decide(record.key, manifest, settings),
    };
    if (record.marketplace) entry.marketplace = record.marketplace;
    if (root) entry.root = root;
    const version = manifestString(manifest, "version") ?? record.version;
    if (version) entry.version = version;
    const description = manifestString(manifest, "description");
    if (description) entry.description = description;
    if (!root && entry.enabled) {
      entry.enabled = false;
      entry.reason = installed
        ? `installed, but its files are missing under ${pluginsDir}`
        : `${entry.reason}, but not installed on this machine`;
    }
    out.push(manifest ? { entry, manifest } : { entry });
  }
  return out;
}

const SKILLS_DIR = "skills-dir";

/**
 * Skills-directory plugins: a directory with `.claude-plugin/plugin.json`
 * under `~/.claude/skills/` (user) or the project folder's own
 * `.claude/skills/` (project; no parent search, and only once the workspace is
 * trusted). Dot-prefixed directories and `synced` are never adopted.
 */
async function skillsDirPlugins(
  run: ResolveRun,
  settings: SettingsEntry[],
): Promise<LoadedPlugin[]> {
  const bases: { dir: string; layer: ConfigLayer }[] = [
    { dir: run.p.join(userClaudeDir(run), "skills"), layer: "user" },
    { dir: run.p.join(run.folder, ".claude", "skills"), layer: "project" },
  ];
  const out: LoadedPlugin[] = [];
  for (const base of bases) {
    for (const dirName of await subdirectories(run, base.dir)) {
      if (dirName === "synced" || dirName.startsWith(".")) continue;
      const root = run.p.join(base.dir, dirName);
      const manifestPath = run.p.join(root, ".claude-plugin", "plugin.json");
      const manifest = await readJsonFile(run, manifestPath);
      if (!manifest) continue;
      const name = manifestString(manifest, "name") ?? dirName;
      const id = `${name}@${SKILLS_DIR}`;
      const entry: PluginEntry = {
        path: manifestPath,
        layer: base.layer,
        id,
        name,
        origin: "skills-dir",
        root,
        ...decide(id, manifest, settings),
      };
      if (base.layer === "project" && entry.enabled) {
        entry.reason += "; a project skills-dir plugin loads only once the workspace is trusted";
      }
      const version = manifestString(manifest, "version");
      if (version) entry.version = version;
      const description = manifestString(manifest, "description");
      if (description) entry.description = description;
      out.push({ entry, manifest });
    }
  }
  return out;
}

/**
 * Plugins synced from claude.ai: `~/.claude/plugins/synced/<bucket>/<plugin>/`
 * with a `.claude-plugin/plugin.json`. The bucket layout isn't documented;
 * this follows what Claude Code 2.1.280 leaves on disk. `syncClaudeAiPlugins:
 * false` turns them all off.
 */
async function syncedPlugins(
  run: ResolveRun,
  settings: SettingsEntry[],
): Promise<LoadedPlugin[]> {
  const syncedDir = run.p.join(userClaudeDir(run), "plugins", "synced");
  const syncOff = settingsByPriority(settings).find(
    (entry) => typeof entry.values["syncClaudeAiPlugins"] === "boolean",
  );
  const out: LoadedPlugin[] = [];
  for (const bucket of await subdirectories(run, syncedDir)) {
    if (bucket.startsWith(".")) continue;
    for (const dirName of await subdirectories(run, run.p.join(syncedDir, bucket))) {
      if (dirName.startsWith(".")) continue;
      const root = run.p.join(syncedDir, bucket, dirName);
      const manifestPath = run.p.join(root, ".claude-plugin", "plugin.json");
      const manifest = await readJsonFile(run, manifestPath);
      if (!manifest) continue;
      const name = manifestString(manifest, "name") ?? dirName;
      const id = `${name}@synced`;
      const entry: PluginEntry = {
        path: manifestPath,
        layer: "user",
        id,
        name,
        origin: "synced",
        root,
        ...decide(id, manifest, settings),
      };
      if (syncOff && syncOff.values["syncClaudeAiPlugins"] === false) {
        entry.enabled = false;
        entry.reason = `synced plugins are off (syncClaudeAiPlugins: false in ${syncOff.path})`;
        entry.stateSource = syncOff.path;
      }
      out.push({ entry, manifest });
    }
  }
  return out;
}

/**
 * Every plugin Claude Code knows about for this folder, enabled or not.
 *
 * When two enabled plugins share a manifest name, the documented order picks
 * one (docs: /plugins/loading): an installed marketplace plugin beats a
 * skills-dir plugin, a user skills-dir plugin beats a project one, and either
 * beats a synced plugin. The loser is reported disabled with the reason.
 */
export async function collectPlugins(
  run: ResolveRun,
  settings: SettingsEntry[],
): Promise<LoadedPlugin[]> {
  const all = [
    ...(await marketplacePlugins(run, settings)),
    ...(await skillsDirPlugins(run, settings)),
    ...(await syncedPlugins(run, settings)),
  ];
  const taken = new Map<string, LoadedPlugin>();
  for (const plugin of all) {
    if (!plugin.entry.enabled) continue;
    const winner = taken.get(plugin.entry.name);
    if (!winner) {
      taken.set(plugin.entry.name, plugin);
      continue;
    }
    plugin.entry.enabled = false;
    plugin.entry.reason = `not loaded: the name "${plugin.entry.name}" is already taken by ${winner.entry.id} (${winner.entry.path})`;
  }
  return all;
}

/** Only the plugins that load. */
export function enabledPlugins(plugins: LoadedPlugin[]): LoadedPlugin[] {
  return plugins.filter((plugin) => plugin.entry.enabled && plugin.entry.root);
}

/** Manifest path values: a `./relative` string or an array of them. */
function manifestPaths(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

/**
 * Where a plugin keeps one kind of component, as absolute paths.
 *
 * Docs (/plugins/manifest-reference): `skills` **adds** its paths to the
 * default `skills/`; `commands`, `agents`, `outputStyles` and `workflows`
 * **replace** the default; `hooks`, `mcpServers` and `lspServers` merge (use
 * `pluginConfigInOrder` for those, since they can also be inline objects).
 */
export function pluginComponentPaths(
  run: ResolveRun,
  plugin: LoadedPlugin,
  manifestKey: string,
  defaultPath: string,
  mode: "adds" | "replaces",
): string[] {
  const root = plugin.entry.root;
  if (!root) return [];
  const declared = manifestPaths(plugin.manifest?.[manifestKey]).map((path) =>
    run.p.resolve(root, path),
  );
  const fallback = run.p.join(root, defaultPath);
  if (mode === "replaces" && declared.length > 0) return declared;
  return [...new Set([fallback, ...declared])];
}

/* -------------------------------------------------------------------------- */
/* policy and config helpers shared by the collectors                          */
/* -------------------------------------------------------------------------- */

/** A surface `strictPluginOnlyCustomization` can lock. */
export type StrictSurface = "skills" | "agents" | "hooks" | "mcp";

/**
 * The managed settings file whose `strictPluginOnlyCustomization` locks
 * `surface`, if one does.
 *
 * Docs (/settings-reference#strictpluginonlycustomization, Claude Code
 * 2.1.280): managed-only; `true` locks all four surfaces, an array names the
 * ones to lock, and unknown names are ignored. The highest-precedence managed
 * file that sets the key decides (a later drop-in replaces an earlier value).
 */
export function strictPluginOnlyLock(
  settings: SettingsEntry[],
  surface: StrictSurface,
): SettingsEntry | undefined {
  for (const entry of settingsByPriority(settings)) {
    if (entry.layer !== "managed") continue;
    const value = entry.values["strictPluginOnlyCustomization"];
    if (value === true) return entry;
    if (Array.isArray(value)) return value.includes(surface) ? entry : undefined;
  }
  return undefined;
}

/** One chunk of hook or MCP config a plugin contributes, in load order. */
export interface PluginConfig {
  /** The file it came from; the manifest for inline config. */
  path: string;
  value: Record<string, unknown>;
  /** True when it was written inline in `plugin.json`. */
  inline: boolean;
}

/**
 * A plugin's hook or MCP config in the order Claude Code loads it: the default
 * file (`hooks/hooks.json`, `.mcp.json`) first, then each shape the manifest
 * key declares, in order. Docs (/plugins/manifest-reference, `hooks` and
 * `mcpServers`): the key takes a `./path.json`, an inline object, or an array
 * mixing both. Order matters for
 * MCP, where a later server name replaces an earlier one.
 *
 * MCP bundles (`.mcpb`/`.dxt`, paths or URLs) are skipped: they're extracted
 * at load time and there's nothing to read statically. With `insideRootOnly`,
 * a file outside the plugin directory is skipped too (docs: /plugins/loading,
 * a project-scope plugin's MCP servers from such a file don't load).
 */
export async function pluginConfigInOrder(
  run: ResolveRun,
  plugin: LoadedPlugin,
  manifestKey: string,
  defaultFile: string,
  options: { insideRootOnly?: boolean } = {},
): Promise<PluginConfig[]> {
  const root = plugin.entry.root;
  if (!root) return [];
  const manifestPath = run.p.join(root, ".claude-plugin", "plugin.json");
  const declared = plugin.manifest?.[manifestKey];
  const items: unknown[] = Array.isArray(declared)
    ? declared
    : declared === undefined
      ? []
      : [declared];

  const out: PluginConfig[] = [];
  const seen = new Set<string>();
  const readFile = async (file: string): Promise<void> => {
    if (seen.has(file)) return;
    seen.add(file);
    const value = await readJsonFile(run, file);
    if (value) out.push({ path: file, value, inline: false });
  };

  await readFile(run.p.join(root, defaultFile));
  for (const item of items) {
    if (isRecord(item)) {
      out.push({ path: manifestPath, value: item, inline: true });
      continue;
    }
    if (typeof item !== "string") continue;
    if (/\.(mcpb|dxt)$/i.test(item) || /^https?:\/\//i.test(item)) {
      run.diagnostics.push(
        `${manifestPath}: ${manifestKey} entry ${item} is an MCP bundle; its servers can't be read statically`,
      );
      continue;
    }
    const file = run.p.resolve(root, item);
    const relative = run.p.relative(root, file);
    if (options.insideRootOnly && (relative.startsWith("..") || run.p.isAbsolute(relative))) {
      run.diagnostics.push(
        `${manifestPath}: ${manifestKey} entry ${item} is outside the plugin directory; a project plugin's servers from it don't load`,
      );
      continue;
    }
    await readFile(file);
  }
  return out;
}

/** Replaces `${CLAUDE_PLUGIN_ROOT}` the way Claude Code does in hook commands and MCP config. */
export function expandPluginRoot(text: string, plugin: LoadedPlugin): string {
  const root = plugin.entry.root;
  return root ? text.replaceAll("${CLAUDE_PLUGIN_ROOT}", root) : text;
}
