import { parse as parseYaml } from "yaml";

import { readText, type ResolveRun } from "./context.js";
import { isRecord } from "./json.js";

import {
  enabledPlugins,
  enabledPluginsSetting,
  expandPluginRoot,
  pluginConfigInOrder,
  strictPluginOnlyLock,
  type LoadedPlugin,
} from "./plugins.js";
import {
  CONFIG_LAYER_PRECEDENCE,
  type AgentEntry,
  type ConfigLayer,
  type EffectiveSettings,
  type HookEntry,
  type HookSource,
  type SettingsEntry,
  type SkillEntry,
} from "./types.js";

const EDIT_EVENTS = new Set(["PreToolUse", "PostToolUse"]);
const EDIT_TOOLS = ["Edit", "Write", "MultiEdit"];

/**
 * Would this hook run when the selected file is edited? A missing, empty or
 * `*` matcher fires for everything; otherwise the matcher is read both as a
 * pipe-separated tool list and as a regex over the edit tool names.
 */
export function firesOnEdit(event: string, matcher: string | undefined): boolean {
  if (!EDIT_EVENTS.has(event)) return false;
  const value = matcher?.trim() ?? "";
  if (value.length === 0 || value === "*") return true;

  const parts = value.split("|").map((part) => part.trim());
  if (parts.some((part) => EDIT_TOOLS.includes(part))) return true;

  try {
    const pattern = new RegExp(value);
    return EDIT_TOOLS.some((tool) => pattern.test(tool));
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Reading hook config                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What a handler runs, by `type` (docs: /hooks#hook-handler-fields, Claude
 * Code 2.1.280): `command` (plus `args` in exec form), `http` → `url`,
 * `prompt`/`agent` → `prompt`, `mcp_tool` → `tool` on `server`. `type` is
 * required by the docs; a handler without one but with a `command` is read as
 * a command hook, as this resolver always has.
 */
function handler(
  hook: Record<string, unknown>,
  expand: (text: string) => string,
): { type: string; text: string } | undefined {
  const str = (key: string): string | undefined => {
    const value = hook[key];
    return typeof value === "string" ? expand(value) : undefined;
  };
  const type = typeof hook["type"] === "string" ? hook["type"] : "command";
  switch (type) {
    case "command": {
      const command = str("command");
      if (command === undefined) return undefined;
      const args = Array.isArray(hook["args"])
        ? hook["args"].filter((a): a is string => typeof a === "string").map(expand)
        : [];
      return { type, text: [command, ...args].join(" ") };
    }
    case "http": {
      const url = str("url");
      return url === undefined ? undefined : { type, text: url };
    }
    case "prompt":
    case "agent": {
      const prompt = str("prompt");
      return prompt === undefined ? undefined : { type, text: prompt };
    }
    case "mcp_tool": {
      const server = str("server");
      const tool = str("tool");
      return server === undefined || tool === undefined
        ? undefined
        : { type, text: `${tool} on ${server}` };
    }
    default: {
      const text = str("command") ?? str("url") ?? str("prompt");
      return text === undefined ? undefined : { type, text };
    }
  }
}

interface HookOrigin {
  path: string;
  layer: ConfigLayer;
  source?: HookSource;
  plugin?: string;
  owner?: string;
  /** Replaces `${CLAUDE_PLUGIN_ROOT}` for plugin hooks. */
  expand?: (text: string) => string;
  /** The event Claude Code registers a declared event under. */
  event?: (declared: string) => string;
  /** Extra note for a hook, given its declared event and handler. */
  note?: (declared: string, hook: Record<string, unknown>) => string | undefined;
}

/**
 * Reads a `{ Event: [ { matcher?, hooks: [handler] } ] }` object, the shape
 * settings files, plugin hook files and skill/agent frontmatter all share
 * (docs: /hooks#configuration).
 */
function readHookMap(hooks: unknown, origin: HookOrigin): HookEntry[] {
  if (!isRecord(hooks)) return [];
  const expand = origin.expand ?? ((text: string) => text);
  const out: HookEntry[] = [];
  for (const [declared, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const event = origin.event?.(declared) ?? declared;
    for (const group of groups) {
      if (!isRecord(group)) continue;
      const rawMatcher = group["matcher"];
      const matcher = typeof rawMatcher === "string" ? rawMatcher : undefined;
      const handlers = group["hooks"];
      if (!Array.isArray(handlers)) continue;
      for (const hook of handlers) {
        if (!isRecord(hook)) continue;
        const what = handler(hook, expand);
        if (!what) continue;
        const timeout = hook["timeout"];
        const item: HookEntry = {
          path: origin.path,
          layer: origin.layer,
          event,
          command: what.text,
          type: what.type,
          firesOnEdit: firesOnEdit(event, matcher),
        };
        if (matcher !== undefined) item.matcher = matcher;
        if (typeof timeout === "number") item.timeoutSeconds = timeout;
        if (origin.source) item.source = origin.source;
        if (origin.plugin) item.plugin = origin.plugin;
        if (origin.owner) item.owner = origin.owner;
        const note = origin.note?.(declared, hook);
        if (note) item.note = note;
        out.push(item);
      }
    }
  }
  return out;
}

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * The `hooks:` value of a markdown file's YAML frontmatter, or `undefined`.
 *
 * Only the `hooks:` block is handed to the YAML parser (the key line and every
 * following line that is indented, blank or a comment), so an unquoted colon
 * in some other field, which the rest of this resolver tolerates, can't sink
 * the hooks. Throws when the block itself isn't valid YAML.
 */
export function frontmatterHooks(content: string): unknown {
  const match = FRONTMATTER.exec(content);
  if (!match) return undefined;
  const lines = (match[1] ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^hooks\s*:/.test(line));
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end]!;
    if (line.trim().length > 0 && !/^\s/.test(line) && !line.startsWith("#")) break;
    end += 1;
  }
  const parsed: unknown = parseYaml(lines.slice(start, end).join("\n"));
  return isRecord(parsed) ? parsed["hooks"] : undefined;
}

async function readFrontmatterHooks(
  run: ResolveRun,
  path: string,
): Promise<unknown> {
  const content = await readText(run, path);
  if (content === null) return undefined;
  try {
    return frontmatterHooks(content);
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    run.diagnostics.push(`${path}: frontmatter hooks aren't valid YAML (${message})`);
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Which hooks run                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Who a hook belongs to, for the switches that turn hooks off.
 *
 * - `managed`: managed settings, or a managed skill/subagent (deployed by the
 *   organization the same way);
 * - `forced`: a plugin that managed `enabledPlugins` force-enables, or a skill
 *   from one;
 * - `other`: everything else.
 */
type Trust = "managed" | "forced" | "other";

interface Tagged {
  hook: HookEntry;
  trust: Trust;
  /** Declared in a user/project/local settings file. */
  userSettings?: boolean;
  /** Declared in subagent frontmatter. */
  agentFrontmatter?: boolean;
  /** Set when the declaring skill/subagent itself doesn't load. */
  ownerOff?: string;
}

/**
 * Why Claude Code wouldn't run a hook, or `undefined` when it would.
 *
 * Docs (/settings-reference `disableAllHooks`, `allowManagedHooksOnly`,
 * `strictPluginOnlyCustomization.hooks`; /hooks#hook-locations; Claude Code
 * 2.1.280):
 *
 * - `disableAllHooks` in managed settings disables every hook, managed ones
 *   included. Set outside managed settings (and winning precedence) it
 *   disables user, project, local and plugin hooks; managed hooks and hooks of
 *   plugins force-enabled in managed `enabledPlugins` keep running.
 * - `allowManagedHooksOnly` runs only managed hooks and force-enabled plugin
 *   hooks, and names agent-frontmatter hooks among the blocked. The docs don't
 *   mention skill frontmatter; since only the listed kinds run, a skill's
 *   hooks are blocked too unless the skill is managed or from a force-enabled
 *   plugin. Agent-frontmatter hooks are blocked even for a managed subagent,
 *   as the docs list them without exception.
 * - `strictPluginOnlyCustomization` with `hooks` stops hooks from user,
 *   project and local settings files; plugin and managed hooks keep running.
 *   It doesn't name frontmatter hooks; those go when the `skills`/`agents`
 *   lock drops their skill or subagent (reported through `ownerOff`).
 */
function disabledReason(
  tagged: Tagged,
  effective: EffectiveSettings,
  strictHooks: SettingsEntry | undefined,
): string | undefined {
  const disableAll = effective.disableAllHooks;
  const disableAllSource = disableAll.value ? disableAll.source : undefined;
  if (disableAllSource?.layer === "managed") {
    return `disableAllHooks in ${disableAllSource.path} (managed) turns off every hook`;
  }

  const managedOnly = effective.allowManagedHooksOnly;
  if (managedOnly.value && managedOnly.source) {
    if (tagged.agentFrontmatter) {
      return `allowManagedHooksOnly in ${managedOnly.source.path} blocks hooks declared in subagent frontmatter`;
    }
    if (tagged.trust === "other") {
      return `allowManagedHooksOnly in ${managedOnly.source.path}: only managed hooks and hooks of plugins managed settings force-enable run`;
    }
  }

  if (disableAllSource && tagged.trust === "other") {
    return `disableAllHooks in ${disableAllSource.path}`;
  }

  if (strictHooks && tagged.userSettings) {
    return `strictPluginOnlyCustomization locks hooks in ${strictHooks.path}: hooks from user, project and local settings don't run`;
  }

  return tagged.ownerOff;
}

/** True when managed `enabledPlugins` force-enables the plugin (by full id). */
function forceEnabled(plugin: LoadedPlugin, settings: SettingsEntry[]): boolean {
  const decision = enabledPluginsSetting(plugin.entry.id, settings);
  return decision?.layer === "managed" && decision.value;
}

/**
 * Plugin hooks: `hooks/hooks.json` plus whatever the manifest `hooks` key
 * declares (a path, an inline object, or an array of both); all of them load
 * (docs: /plugins/components#hooks, /plugins/manifest-reference `hooks`).
 * `hooks/hooks.json` wraps the events in a top-level `hooks` key (next to an
 * optional `description`); an inline manifest object is the event map itself.
 * `${CLAUDE_PLUGIN_ROOT}` is substituted in `command`, `args`, and the other
 * string fields.
 */
async function pluginHooks(
  run: ResolveRun,
  plugins: LoadedPlugin[],
  settings: SettingsEntry[],
): Promise<Tagged[]> {
  const out: Tagged[] = [];
  for (const plugin of enabledPlugins(plugins)) {
    const trust: Trust = forceEnabled(plugin, settings) ? "forced" : "other";
    for (const source of await pluginConfigInOrder(run, plugin, "hooks", "hooks/hooks.json")) {
      const map = isRecord(source.value["hooks"]) ? source.value["hooks"] : source.value;
      const hooks = readHookMap(map, {
        path: source.path,
        layer: plugin.entry.layer,
        source: "plugin",
        plugin: plugin.entry.name,
        expand: (text) => expandPluginRoot(text, plugin),
      });
      out.push(...hooks.map((hook) => ({ hook, trust })));
    }
  }
  return out;
}

function ownerOff(kind: string, owner: SkillEntry | AgentEntry): string | undefined {
  if (owner.disabled) return `the ${kind} ${owner.name} doesn't load: ${owner.disabled}`;
  if (owner.shadowedBy) {
    return `the ${kind} ${owner.name} is shadowed by ${owner.shadowedBy.path}`;
  }
  return undefined;
}

/**
 * Hooks in skill frontmatter (docs: /hooks#hooks-in-skills-and-agents,
 * /skills frontmatter `hooks`): registered when the skill is invoked and kept
 * for the rest of the session; `once: true` is honoured only here.
 */
async function skillHooks(
  run: ResolveRun,
  skills: SkillEntry[],
  plugins: LoadedPlugin[],
  settings: SettingsEntry[],
): Promise<Tagged[]> {
  const out: Tagged[] = [];
  for (const skill of skills) {
    const map = await readFrontmatterHooks(run, skill.path);
    if (!isRecord(map)) continue;
    const plugin =
      skill.source === "plugin"
        ? enabledPlugins(plugins).find((p) => p.entry.name === skill.plugin)
        : undefined;
    const trust: Trust =
      skill.source === "managed"
        ? "managed"
        : plugin && forceEnabled(plugin, settings)
          ? "forced"
          : "other";
    const off = ownerOff("skill", skill);
    const hooks = readHookMap(map, {
      path: skill.path,
      layer: skill.layer,
      source: "skill",
      owner: skill.name,
      ...(plugin ? { expand: (text: string) => expandPluginRoot(text, plugin) } : {}),
      note: (_declared, hook) =>
        hook["once"] === true
          ? `registered when /${skill.name} is invoked; removed after its first successful run (once: true)`
          : `registered when /${skill.name} is invoked, then runs for the rest of the session`,
    });
    out.push(...hooks.map((hook) => (off ? { hook, trust, ownerOff: off } : { hook, trust })));
  }
  return out;
}

/**
 * Hooks in subagent frontmatter (docs: /sub-agents#hooks-in-subagent-frontmatter,
 * /hooks#hooks-in-skills-and-agents): they run only while that subagent runs.
 * A `Stop` hook there is converted to `SubagentStop`, the event that fires
 * when a subagent finishes, so it is reported under the event Claude Code
 * registers (it stays `Stop` only when the agent runs as the main session via
 * `--agent` or the `agent` setting). Plugin subagents ignore `hooks`, so they
 * are skipped. A project subagent's hooks also need workspace trust for its
 * folder; this resolver assumes a trusted folder, as it does elsewhere.
 */
async function agentHooks(run: ResolveRun, agents: AgentEntry[]): Promise<Tagged[]> {
  const out: Tagged[] = [];
  for (const agent of agents) {
    if (agent.plugin) continue;
    const map = await readFrontmatterHooks(run, agent.path);
    if (!isRecord(map)) continue;
    const trust: Trust = agent.layer === "managed" ? "managed" : "other";
    const off = ownerOff("subagent", agent);
    const hooks = readHookMap(map, {
      path: agent.path,
      layer: agent.layer,
      source: "agent",
      owner: agent.name,
      event: (declared) => (declared === "Stop" ? "SubagentStop" : declared),
      note: (declared) =>
        declared === "Stop"
          ? `runs only while the ${agent.name} subagent runs; declared as Stop, which Claude Code registers as SubagentStop`
          : `runs only while the ${agent.name} subagent runs`,
    });
    out.push(
      ...hooks.map((hook) => ({
        hook,
        trust,
        agentFrontmatter: true,
        ...(off ? { ownerOff: off } : {}),
      })),
    );
  }
  return out;
}

/**
 * Every hook Claude Code would register here: settings files (managed first,
 * then user, project, local), then enabled plugins, then skill and subagent
 * frontmatter. Hooks it wouldn't run stay in the list with `disabled` saying
 * why.
 */
export async function collectHooks(
  run: ResolveRun,
  settings: SettingsEntry[],
  plugins: LoadedPlugin[],
  skills: SkillEntry[],
  agents: AgentEntry[],
  effective: EffectiveSettings,
): Promise<HookEntry[]> {
  const ordered = [...settings].sort(
    (a, b) =>
      CONFIG_LAYER_PRECEDENCE.indexOf(a.layer) - CONFIG_LAYER_PRECEDENCE.indexOf(b.layer),
  );

  const tagged: Tagged[] = [];
  for (const entry of ordered) {
    const managed = entry.layer === "managed";
    for (const hook of readHookMap(entry.values["hooks"], { path: entry.path, layer: entry.layer })) {
      tagged.push({ hook, trust: managed ? "managed" : "other", userSettings: !managed });
    }
  }
  tagged.push(
    ...(await pluginHooks(run, plugins, settings)),
    ...(await skillHooks(run, skills, plugins, settings)),
    ...(await agentHooks(run, agents)),
  );

  const strictHooks = strictPluginOnlyLock(settings, "hooks");
  return tagged.map((item) => {
    const reason = disabledReason(item, effective, strictHooks);
    if (reason) item.hook.disabled = reason;
    return item.hook;
  });
}
