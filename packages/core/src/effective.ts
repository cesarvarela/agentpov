import { enabledPluginsSetting } from "./plugins.js";
import { asBoolean, asString, effectiveSetting, settingsByPriority } from "./settings.js";
import {
  type EffectiveSettings,
  type EffectiveValue,
  type InstructionFilesMode,
  type SettingsEntry,
} from "./types.js";

const PERMISSION_MODES = new Set([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
  "manual",
]);

const INSTRUCTION_FILES = new Set<InstructionFilesMode>([
  "claude-md-or-agents-md",
  "claude-md-and-agents-md",
  "claude-md",
  "managed-only",
]);

/** The built-in plugin that reads `AGENTS.md` (Claude Code 2.1.277+). */
export const AGENTS_MD_PLUGIN = "agents-md@builtin";

/**
 * Session-wide switches, each with the settings file that decided it.
 * Docs: /settings-reference (each key), /memory#agents-md (`instructionFiles`).
 */
export function collectEffective(settings: SettingsEntry[]): EffectiveSettings {
  const permissionMode = effectiveSetting(settings, "permissions.defaultMode", {
    parse: (raw) => {
      const value = asString(raw);
      return value && PERMISSION_MODES.has(value) ? value : undefined;
    },
    default: "default",
    // Docs: `auto` and `bypassPermissions` are ignored in project and local settings.
    reject: (value, entry) =>
      (value === "auto" || value === "bypassPermissions") &&
      (entry.layer === "project" || entry.layer === "local")
        ? `${value} can't be set from ${entry.layer} settings`
        : undefined,
  });
  if (permissionMode.value === "bypassPermissions") {
    const lock = effectiveSetting(settings, "permissions.disableBypassPermissionsMode", {
      parse: (raw) => (raw === "disable" ? "disable" : undefined),
      default: undefined as "disable" | undefined,
    });
    if (lock.value === "disable" && lock.source) {
      permissionMode.value = "default";
      permissionMode.note = `bypassPermissions is disabled by permissions.disableBypassPermissionsMode in ${lock.source.path}`;
    }
  }

  const instructionFiles = effectiveSetting<InstructionFilesMode>(
    settings,
    `pluginConfigs.${AGENTS_MD_PLUGIN}.options.instructionFiles`,
    {
      parse: (raw) =>
        typeof raw === "string" && INSTRUCTION_FILES.has(raw as InstructionFilesMode)
          ? (raw as InstructionFilesMode)
          : undefined,
      default: "claude-md-or-agents-md",
      // Docs (/memory#agents-md): ignored in project and local settings files.
      layers: ["managed", "user"],
    },
  );
  const agentsMdPlugin = enabledPluginsSetting(AGENTS_MD_PLUGIN, settings);
  if (agentsMdPlugin?.value === false && instructionFiles.value !== "managed-only") {
    instructionFiles.value = "claude-md";
    instructionFiles.note = `the built-in agents-md plugin is disabled in ${agentsMdPlugin.path}, so only CLAUDE.md files load`;
  }


  return {
    permissionMode,
    outputStyle: effectiveSetting(settings, "outputStyle", { parse: asString, default: "Default" }),
    instructionFiles,
    autoMemory: effectiveSetting(settings, "autoMemoryEnabled", { parse: asBoolean, default: true }),
    disableAllHooks: effectiveSetting(settings, "disableAllHooks", { parse: asBoolean, default: false }),
    allowManagedHooksOnly: effectiveSetting(settings, "allowManagedHooksOnly", {
      parse: asBoolean,
      default: false,
      layers: ["managed"],
    }),
    workflows: workflowsOn(settings),
  };
}

/**
 * Whether saved workflows are on. Docs (/settings-reference): `disableWorkflows:
 * true` in any file turns them off and nothing turns them back on; otherwise
 * `enableWorkflows` decides by the usual precedence; unset means on, except on
 * the Pro plan (which agentpov can't see).
 */
function workflowsOn(settings: SettingsEntry[]): EffectiveValue<boolean> {
  const disabler = settingsByPriority(settings).find(
    (entry) => entry.values["disableWorkflows"] === true,
  );
  if (disabler) {
    return {
      value: false,
      key: "disableWorkflows",
      source: { path: disabler.path, layer: disabler.layer },
    };
  }
  const enable = effectiveSetting(settings, "enableWorkflows", { parse: asBoolean, default: true });
  if (!enable.source) enable.note = "on by default, except on the Pro plan";
  return enable;
}
