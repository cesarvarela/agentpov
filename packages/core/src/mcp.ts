import { ancestorsOf, readText, userConfigJsonPath, type ResolveRun } from "./context.js";
import { isRecord, parseLenientJson } from "./json.js";
import {
  enabledPlugins,
  expandPluginRoot,
  pluginConfigInOrder,
  strictPluginOnlyLock,
  type LoadedPlugin,
} from "./plugins.js";
import { asBoolean, effectiveSetting, readJsonFile, settingsByPriority } from "./settings.js";
import {
  type ConfigLayer,
  type McpServerEntry,
  type McpServerState,
  type SettingsEntry,
} from "./types.js";


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
 * Approval state of a `.mcp.json` server (or a project skills-dir plugin's
 * server, which goes through the same approval, docs: /plugins/loading).
 *
 * Docs (/mcp, /settings-reference `enableAllProjectMcpServers`,
 * `enabledMcpjsonServers`, `disabledMcpjsonServers`): all three are valid in
 * any settings file. A rejection anywhere wins over any approval.
 * `enableAllProjectMcpServers` is single-valued: in a trusted folder a
 * `false` in a higher-precedence file overrides a `true` in a lower one.
 *
 * Settings are scanned highest precedence first (managed > local > project >
 * user) so the reason names the most specific file that decided.
 *
 * `names` holds every name the server may be listed under; for a plugin
 * server that's the bare key and `plugin:<plugin>:<server>`. The docs don't
 * say which one the approval lists use for plugin servers, so either counts.
 */
function mcpJsonApproval(names: string[], settings: SettingsEntry[]): Approval {
  const ordered = settingsByPriority(settings);
  const listed = (entry: SettingsEntry, key: string): string | undefined => {
    const list = stringList(entry.values[key]);
    return names.find((name) => list.includes(name));
  };

  for (const entry of ordered) {
    if (listed(entry, "disabledMcpjsonServers") !== undefined) {
      return {
        state: "disabled",
        reason: `disabled by disabledMcpjsonServers in ${entry.path}`,
        stateSource: entry.path,
        stateKey: "disabledMcpjsonServers",
      };
    }
  }

  for (const entry of ordered) {
    if (listed(entry, "enabledMcpjsonServers") !== undefined) {
      return {
        state: "enabled",
        reason: `approved by enabledMcpjsonServers in ${entry.path}`,
        stateSource: entry.path,
        stateKey: "enabledMcpjsonServers",
      };
    }
  }

  const all = ordered.find(
    (entry) => typeof entry.values["enableAllProjectMcpServers"] === "boolean",
  );
  if (all?.values["enableAllProjectMcpServers"] === true) {
    return {
      state: "enabled",
      reason: `approved by enableAllProjectMcpServers in ${all.path}`,
      stateSource: all.path,
      stateKey: "enableAllProjectMcpServers",
    };
  }

  const off = all ? ` (enableAllProjectMcpServers is false in ${all.path})` : "";
  return {
    state: "unapproved",
    reason: `not approved in any settings file (no enableAllProjectMcpServers, not in enabledMcpjsonServers)${off}; Claude Code would prompt on first use`,
  };
}

/** Where a server came from; decides which policies apply to it. */
type Origin =
  | "managed-file"
  | "managed-setting"
  | "user"
  | "project"
  | "local"
  | "plugin";

/** A server plus what the allow/deny lists match on. */
interface Candidate {
  entry: McpServerEntry;
  origin: Origin;
  /** Every name it may be listed under (bare key, and scoped name for plugins). */
  names: string[];
  /** `[command, ...args]` for a stdio server. */
  argv?: string[];
  url?: string;
  remote: boolean;
  /** True when a value uses `${VAR}` expansion. */
  usesEnvVars: boolean;
}

const ENV_REFERENCE = /\$\{[^}]+\}/;

function describeServer(
  path: string,
  layer: ConfigLayer,
  name: string,
  config: unknown,
  origin: Origin,
  expand: (text: string) => string = (text) => text,
): Candidate {
  const entry: McpServerEntry = {
    path,
    layer,
    name,
    transport: "unknown",
    state: "enabled",
    reason: "",
  };
  const candidate: Candidate = {
    entry,
    origin,
    names: [name],
    remote: false,
    usesEnvVars: false,
  };
  if (!isRecord(config)) return candidate;

  const type = config["type"];
  const url = typeof config["url"] === "string" ? expand(config["url"]) : undefined;
  const command = typeof config["command"] === "string" ? expand(config["command"]) : undefined;
  const args = stringList(config["args"]).map(expand);
  if (type === "http" || type === "sse" || type === "stdio") entry.type = type;
  if (type === "http" || type === "sse") entry.transport = type;
  else if (url !== undefined) entry.transport = "http";
  else if (type === "stdio" || command !== undefined) entry.transport = "stdio";

  if (url !== undefined) {
    entry.target = url;
    candidate.url = url;
  } else if (command !== undefined) {
    entry.target = [command, ...args].join(" ");
    candidate.argv = [command, ...args];
  }
  candidate.remote = entry.transport === "http" || entry.transport === "sse" || url !== undefined;

  const expandValues = (map: Record<string, string> | undefined) =>
    map && Object.fromEntries(Object.entries(map).map(([k, v]) => [k, expand(v)]));
  const env = expandValues(stringMap(config["env"]));
  if (env) entry.env = env;
  const headers = expandValues(stringMap(config["headers"]));
  if (headers) entry.headers = headers;

  candidate.usesEnvVars = [
    url,
    command,
    ...args,
    ...Object.values(env ?? {}),
    ...Object.values(headers ?? {}),
  ].some((value) => value !== undefined && ENV_REFERENCE.test(value));
  return candidate;
}

function serverMap(
  value: unknown,
  path: string,
  layer: ConfigLayer,
  origin: Origin,
): Candidate[] {
  if (!isRecord(value)) return [];
  return Object.keys(value)
    .sort()
    .map((name) => describeServer(path, layer, name, value[name], origin));
}

function apply(candidate: Candidate, approval: Approval): void {
  const { entry } = candidate;
  entry.state = approval.state;
  entry.reason = approval.reason;
  if (approval.stateSource) entry.stateSource = approval.stateSource;
  else delete entry.stateSource;
  if (approval.stateKey) entry.stateKey = approval.stateKey;
  else delete entry.stateKey;
}

/* ------------------------------ plugin servers ----------------------------- */

/**
 * MCP servers from every enabled plugin.
 *
 * Docs (/plugins/components#mcp-servers, /plugins/manifest-reference
 * `mcpServers`, /mcp#plugin-provided-mcp-servers, Claude Code 2.1.280):
 * `.mcp.json` at the plugin root loads first (with or without the
 * `mcpServers` wrapper), then each shape the manifest key declares; a later
 * server name replaces an earlier one. `${CLAUDE_PLUGIN_ROOT}` is substituted
 * in `command`, `args`, `env`, `url` and `headers`. The server registers as
 * `plugin:<plugin>:<server>`.
 *
 * A user-scope plugin's servers start with no approval. A project skills-dir
 * plugin's go through the same per-server approval as `.mcp.json`, and a file
 * outside its directory is skipped (docs: /plugins/loading).
 */
async function pluginServers(
  run: ResolveRun,
  plugins: LoadedPlugin[],
  settings: SettingsEntry[],
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const plugin of enabledPlugins(plugins)) {
    const project = plugin.entry.layer === "project";
    const sources = await pluginConfigInOrder(run, plugin, "mcpServers", ".mcp.json", {
      insideRootOnly: project,
    });
    const servers = new Map<string, { path: string; config: unknown }>();
    for (const source of sources) {
      const map =
        !source.inline && isRecord(source.value["mcpServers"])
          ? source.value["mcpServers"]
          : source.value;
      for (const [name, config] of Object.entries(map)) {
        servers.set(name, { path: source.path, config });
      }
    }

    for (const name of [...servers.keys()].sort()) {
      const { path, config } = servers.get(name)!;
      const scoped = `plugin:${plugin.entry.name}:${name}`;
      const candidate = describeServer(
        path,
        plugin.entry.layer,
        scoped,
        config,
        "plugin",
        (text) => expandPluginRoot(text, plugin),
      );
      candidate.names = [scoped, name];
      candidate.entry.plugin = plugin.entry.name;
      apply(
        candidate,
        project
          ? mcpJsonApproval([name, scoped], settings)
          : {
              state: "enabled",
              reason: `from the enabled plugin ${plugin.entry.id}; plugin servers need no approval`,
              stateSource: plugin.entry.stateSource ?? plugin.entry.path,
            },
      );
      out.push(candidate);
    }
  }
  return out;
}

/* ----------------------------- managed servers ----------------------------- */

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/**
 * Why a `managedMcpServers` entry would be dropped, or `undefined` when it
 * loads. Docs (/managed-mcp#what-an-entry-can-contain): `http`/`sse` (or the
 * `streamable-http` alias), an `https://` url, no `command`/`args`/`env`/
 * `headersHelper`, no `${VAR}` anywhere, and a plain server name.
 */
function managedEntryProblem(name: string, config: unknown): string | undefined {
  if (!SERVER_NAME.test(name)) return "the name may only use letters, numbers, - and _";
  if (!isRecord(config)) return "not an object";
  const type = config["type"];
  if (type !== "http" && type !== "sse" && type !== "streamable-http") {
    return "type must be http or sse";
  }
  const url = config["url"];
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return "url must be an https:// URL";
  for (const key of ["command", "args", "env", "headersHelper"]) {
    if (key in config) return `it may not have ${key}`;
  }
  if (ENV_REFERENCE.test(JSON.stringify(config))) return "it may not use ${VAR} expansion";
  return undefined;
}

/**
 * `managedMcpServers`: remote servers provided from managed settings.
 *
 * Docs (/managed-mcp#provide-servers-through-managed-settings, Claude Code
 * 2.1.259+): read only from managed settings (dropped with a warning
 * elsewhere); invalid entries are dropped and the rest load. Managed files
 * merge in load order, so a later drop-in's entry replaces an earlier one.
 */
function managedSettingServers(run: ResolveRun, settings: SettingsEntry[]): Candidate[] {
  const byName = new Map<string, { path: string; config: unknown }>();
  for (const entry of settings) {
    const value = entry.values["managedMcpServers"];
    if (value === undefined) continue;
    if (entry.layer !== "managed") {
      run.diagnostics.push(
        `${entry.path}: managedMcpServers is only read from managed settings; Claude Code drops it here`,
      );
      continue;
    }
    if (!isRecord(value)) {
      run.diagnostics.push(`${entry.path}: managedMcpServers must be an object keyed by server name`);
      continue;
    }
    for (const [name, config] of Object.entries(value)) {
      const problem = managedEntryProblem(name, config);
      if (problem) {
        run.diagnostics.push(`${entry.path}: managedMcpServers.${name} is dropped: ${problem}`);
        continue;
      }
      byName.set(name, { path: entry.path, config });
    }
  }
  return [...byName.keys()].sort().map((name) => {
    const { path, config } = byName.get(name)!;
    const candidate = describeServer(path, "managed", name, config, "managed-setting");
    apply(candidate, {
      state: "enabled",
      reason: `provided by managedMcpServers in ${path}`,
      stateSource: path,
      stateKey: "managedMcpServers",
    });
    return candidate;
  });
}

/* ------------------------------ allow / deny ------------------------------ */

type PolicyMatch =
  | { kind: "serverName"; value: string }
  | { kind: "serverCommand"; value: string[] }
  | { kind: "serverUrl"; value: string };

interface PolicyItem {
  path: string;
  match: PolicyMatch;
}

function policyItems(entry: SettingsEntry, key: string): PolicyItem[] {
  const list = entry.values[key];
  if (!Array.isArray(list)) return [];
  const out: PolicyItem[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    if (typeof item["serverName"] === "string") {
      out.push({ path: entry.path, match: { kind: "serverName", value: item["serverName"] } });
    } else if (Array.isArray(item["serverCommand"])) {
      out.push({
        path: entry.path,
        match: { kind: "serverCommand", value: stringList(item["serverCommand"]) },
      });
    } else if (typeof item["serverUrl"] === "string") {
      out.push({ path: entry.path, match: { kind: "serverUrl", value: item["serverUrl"] } });
    }
  }
  return out;
}

function describeMatch(match: PolicyMatch): string {
  return match.kind === "serverCommand"
    ? `serverCommand ${JSON.stringify(match.value)}`
    : `${match.kind} ${match.value}`;
}

function wildcard(pattern: string, flags: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, flags);
}

/** `scheme://authority` and the rest (path, query, fragment). */
function splitUrl(url: string): { origin: string; rest: string | undefined } {
  const scheme = url.indexOf("://");
  const start = scheme >= 0 ? scheme + 3 : 0;
  const slash = url.indexOf("/", start);
  if (slash < 0) return { origin: url, rest: undefined };
  return { origin: url.slice(0, slash), rest: url.slice(slash) };
}

/** Lower-case the host and drop a trailing FQDN dot (before any port). */
function normaliseOrigin(origin: string): string {
  return origin.toLowerCase().replace(/\.(?=(:[^:]*)?$)/, "");
}

/**
 * Docs (/managed-mcp#how-a-server-is-evaluated): `*` matches anywhere,
 * including the scheme; the host is case-insensitive and ignores a trailing
 * FQDN dot; paths stay case-sensitive; a pattern with no path matches any path.
 */
export function mcpUrlMatches(pattern: string, url: string): boolean {
  const want = splitUrl(pattern);
  const have = splitUrl(url);
  if (!wildcard(normaliseOrigin(want.origin), "").test(normaliseOrigin(have.origin))) {
    return false;
  }
  if (want.rest === undefined) return true;
  return wildcard(want.rest, "").test(have.rest ?? "/");
}

function matches(candidate: Candidate, match: PolicyMatch): boolean {
  switch (match.kind) {
    case "serverName":
      return candidate.names.includes(match.value);
    case "serverCommand":
      return (
        candidate.argv !== undefined &&
        candidate.argv.length === match.value.length &&
        candidate.argv.every((part, index) => part === match.value[index])
      );
    case "serverUrl":
      return candidate.url !== undefined && mcpUrlMatches(match.value, candidate.url);
  }
}

interface Allowlist {
  items: PolicyItem[];
  /** Files the list came from, highest precedence first. */
  files: string[];
  /** Set when `allowManagedMcpServersOnly` narrowed it to managed settings. */
  lockedBy?: string;
}

/**
 * Docs (/managed-mcp#how-a-server-is-evaluated, /settings-reference
 * `allowedMcpServers`, `allowManagedMcpServersOnly`): allowlists from every
 * settings file merge, unless managed `allowManagedMcpServersOnly` is on, when
 * only the highest-ranked managed file that sets one counts. Unset everywhere
 * means no allowlist; `[]` allows nothing.
 */
function collectAllowlist(settings: SettingsEntry[]): Allowlist | undefined {
  const lock = effectiveSetting(settings, "allowManagedMcpServersOnly", {
    parse: asBoolean,
    default: false,
    layers: ["managed"],
  });
  const ordered = settingsByPriority(settings).filter((entry) =>
    Array.isArray(entry.values["allowedMcpServers"]),
  );
  if (lock.value && lock.source) {
    const managed = ordered.find((entry) => entry.layer === "managed");
    if (!managed) return undefined;
    return {
      items: policyItems(managed, "allowedMcpServers"),
      files: [managed.path],
      lockedBy: lock.source.path,
    };
  }
  if (ordered.length === 0) return undefined;
  return {
    items: ordered.flatMap((entry) => policyItems(entry, "allowedMcpServers")),
    files: ordered.map((entry) => entry.path),
  };
}

function denyDecision(candidate: Candidate, deny: PolicyItem[]): Approval | undefined {
  const hit = deny.find((item) => matches(candidate, item.match));
  if (!hit) return undefined;
  return {
    state: "blocked",
    reason: `blocked by deniedMcpServers (${describeMatch(hit.match)}) in ${hit.path}`,
    stateSource: hit.path,
    stateKey: "deniedMcpServers",
  };
}

/**
 * Docs (/managed-mcp#how-a-server-is-evaluated): a remote server must match a
 * `serverUrl` entry and a stdio server a `serverCommand` entry; a `serverName`
 * match counts only when the list has no entry of that kind.
 */
function allowDecision(candidate: Candidate, allow: Allowlist): Approval | undefined {
  const strongKind = candidate.remote ? "serverUrl" : "serverCommand";
  const hasStrong = allow.items.some((item) => item.match.kind === strongKind);
  const hit = allow.items.find(
    (item) =>
      (item.match.kind === strongKind || (item.match.kind === "serverName" && !hasStrong)) &&
      matches(candidate, item.match),
  );
  if (hit) return undefined;

  const nameOnly =
    hasStrong &&
    allow.items.some((item) => item.match.kind === "serverName" && matches(candidate, item.match));
  const detail =
    allow.items.length === 0
      ? "the allowlist is empty, so it allows none"
      : nameOnly
        ? `its name is listed, but a ${candidate.remote ? "remote" : "stdio"} server must match a ${strongKind} entry once the list has one`
        : `no ${hasStrong ? strongKind : `${strongKind} or serverName`} entry matches`;
  const locked = allow.lockedBy
    ? `; allowManagedMcpServersOnly in ${allow.lockedBy} ignores other allowlists`
    : "";
  return {
    state: "blocked",
    reason: `blocked by allowedMcpServers in ${allow.files.join(", ")}: ${detail}${locked}`,
    stateSource: allow.files[0]!,
    stateKey: "allowedMcpServers",
  };
}

/** Normalised endpoint for the managedMcpServers-over-plugin duplicate check. */
function endpoint(url: string): string {
  const { origin, rest } = splitUrl(url);
  const normalised = normaliseOrigin(origin).replace(/^https:\/\/([^/]*):443$/, "https://$1");
  return `${normalised}${(rest ?? "/").replace(/\/$/, "")}`;
}

/**
 * MCP servers Claude Code knows about for this folder, each with the state it
 * would load in:
 *
 * - `managed-mcp.json` in the managed directory, and `managedMcpServers` from
 *   managed settings (layer `managed`);
 * - `~/.claude.json` (user, and per-project `local`) — always enabled;
 * - `.mcp.json` in the project folder and every folder above it, up to but
 *   not including the filesystem root (Claude Code 2.1.280 reads them past the
 *   git root too) — they carry the approval state the settings give them;
 * - every enabled plugin's servers, named `plugin:<plugin>:<server>`.
 *
 * Then policy, in this order (docs: /managed-mcp, /settings-reference MCP
 * section): `managed-mcp.json` exclusive control, `strictPluginOnlyCustomization`
 * `mcp`, `deniedMcpServers`, `allowedMcpServers`, the `managedMcpServers`
 * precedence over duplicates, and finally the per-project `disabledMcpServers`
 * toggle from `/mcp`.
 */
export async function collectMcpServers(
  run: ResolveRun,
  settings: SettingsEntry[] = [],
  plugins: LoadedPlugin[] = [],
): Promise<McpServerEntry[]> {
  const candidates: Candidate[] = [];

  // managed-mcp.json (docs: /managed-mcp#exclusive-control-with-managed-mcp-json):
  // same format as `.mcp.json`. Its presence alone takes exclusive control,
  // so an unparseable file still shuts every other server out (and loads none).
  const managedFilePath = run.p.join(run.managedDir, "managed-mcp.json");
  const managedFileText = await readText(run, managedFilePath);
  const exclusive = managedFileText !== null;
  if (exclusive) {
    const parsed = parseLenientJson(managedFileText);
    if (!isRecord(parsed)) run.diagnostics.push(`${managedFilePath}: invalid JSON`);
    for (const candidate of serverMap(
      isRecord(parsed) ? parsed["mcpServers"] : undefined,
      managedFilePath,
      "managed",
      "managed-file",
    )) {
      apply(candidate, {
        state: "enabled",
        reason: `deployed in ${managedFilePath}`,
        stateSource: managedFilePath,
      });
      candidates.push(candidate);
    }
  }

  // managedMcpServers; when both define a name, managed-mcp.json's entry wins.
  const managedFileNames = new Set(candidates.map((c) => c.entry.name));
  const provided = managedSettingServers(run, settings);
  for (const candidate of provided) {
    if (managedFileNames.has(candidate.entry.name)) {
      apply(candidate, {
        state: "blocked",
        reason: `replaced by the server of the same name in ${managedFilePath}`,
        stateSource: managedFilePath,
      });
    }
    candidates.push(candidate);
  }

  const userConfigPath = userConfigJsonPath(run);
  const userConfig = await readJsonFile(run, userConfigPath);
  const userApproval: Approval = {
    state: "enabled",
    reason: `declared in ${userConfigPath}; user-scoped servers need no approval`,
    stateSource: userConfigPath,
  };

  if (userConfig) {
    for (const candidate of serverMap(userConfig["mcpServers"], userConfigPath, "user", "user")) {
      apply(candidate, userApproval);
      candidates.push(candidate);
    }
  }

  const dirs = ancestorsOf(run.p, run.folder);
  for (const dir of dirs.slice(0, Math.max(1, dirs.length - 1))) {
    const projectConfigPath = run.p.join(dir, ".mcp.json");
    const projectConfig = await readJsonFile(run, projectConfigPath);
    if (!projectConfig) continue;
    for (const candidate of serverMap(
      projectConfig["mcpServers"],
      projectConfigPath,
      "project",
      "project",
    )) {
      apply(candidate, mcpJsonApproval([candidate.entry.name], settings));
      candidates.push(candidate);
    }
  }

  const scoped = userConfig && isRecord(userConfig["projects"])
    ? userConfig["projects"][run.folder]
    : undefined;
  if (isRecord(scoped)) {
    for (const candidate of serverMap(scoped["mcpServers"], userConfigPath, "local", "local")) {
      apply(candidate, userApproval);
      candidates.push(candidate);
    }
  }

  candidates.push(...(await pluginServers(run, plugins, settings)));

  // Policy.
  const strict = strictPluginOnlyLock(settings, "mcp");
  const deny = settings.flatMap((entry) => policyItems(entry, "deniedMcpServers"));
  const allow = collectAllowlist(settings);
  // Provided servers that survive policy, filled as the loop meets them
  // (they come before every server they can outrank).
  const providedNames = new Map<string, string>();
  const providedUrls = new Map<string, McpServerEntry>();
  const toggledOff = new Set(isRecord(scoped) ? stringList(scoped["disabledMcpServers"]) : []);

  for (const candidate of candidates) {
    const { origin, entry } = candidate;
    const managed = origin === "managed-file" || origin === "managed-setting";
    if (entry.state === "blocked") continue;

    if (exclusive && !managed) {
      apply(candidate, {
        state: "blocked",
        reason: `${managedFilePath} is deployed and has exclusive control over MCP servers`,
        stateSource: managedFilePath,
      });
      continue;
    }

    if (strict && (origin === "user" || origin === "project" || origin === "local")) {
      apply(candidate, {
        state: "blocked",
        reason: `strictPluginOnlyCustomization locks mcp in ${strict.path}: servers from ~/.claude.json and .mcp.json don't load`,
        stateSource: strict.path,
        stateKey: "strictPluginOnlyCustomization",
      });
      continue;
    }

    const denied = denyDecision(candidate, deny);
    if (denied) {
      apply(candidate, denied);
      continue;
    }

    // The organization's own servers skip the allowlist: every
    // managedMcpServers entry, and managed-mcp.json entries without `${VAR}`.
    const exempt =
      origin === "managed-setting" || (origin === "managed-file" && !candidate.usesEnvVars);
    const notAllowed = allow && !exempt ? allowDecision(candidate, allow) : undefined;
    if (notAllowed) {
      apply(candidate, notAllowed);
      continue;
    }

    // Docs (/mcp#scope-hierarchy-and-precedence): a provided server outranks
    // a local/project/user server of the same name, and a plugin server at
    // the same URL.
    const byName =
      origin === "user" || origin === "project" || origin === "local"
        ? providedNames.get(entry.name)
        : undefined;
    const byUrl =
      origin === "plugin" && candidate.url ? providedUrls.get(endpoint(candidate.url)) : undefined;
    if (byName || byUrl) {
      const source = byName ?? byUrl!.path;
      apply(candidate, {
        state: "blocked",
        reason: byName
          ? `managedMcpServers in ${source} provides a server of the same name, which Claude Code uses instead`
          : `managedMcpServers in ${source} provides ${byUrl!.name} at the same URL, which Claude Code uses instead`,
        stateSource: source,
        stateKey: "managedMcpServers",
      });
      continue;
    }

    // Docs (/mcp#disable-a-server-without-removing-it): the `/mcp` toggle
    // writes `disabledMcpServers` under the project in ~/.claude.json. It
    // covers user-configured, plugin and provided servers; `.mcp.json`
    // servers use disabledMcpjsonServers instead.
    if (origin === "managed-setting") {
      providedNames.set(entry.name, entry.path);
      if (candidate.url) providedUrls.set(endpoint(candidate.url), entry);
    }
    if (
      entry.state === "enabled" &&
      origin !== "project" &&
      origin !== "managed-file" &&
      candidate.names.some((name) => toggledOff.has(name))
    ) {
      apply(candidate, {
        state: "disabled",
        reason: `turned off in /mcp (disabledMcpServers for this project in ${userConfigPath})`,
        stateSource: userConfigPath,
        stateKey: "disabledMcpServers",
      });
    }
  }

  return candidates.map((candidate) => candidate.entry);
}
