import { isRecord } from "./json.js";
import {
  CONFIG_LAYER_PRECEDENCE,
  type HookEntry,
  type SettingsEntry,
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

/** Every hook command registered by the settings layers, lowest precedence first. */
export function collectHooks(settings: SettingsEntry[]): HookEntry[] {
  const ordered = [...settings].sort(
    (a, b) =>
      CONFIG_LAYER_PRECEDENCE.indexOf(a.layer) - CONFIG_LAYER_PRECEDENCE.indexOf(b.layer),
  );

  const out: HookEntry[] = [];
  for (const entry of ordered) {
    const hooks = entry.values["hooks"];
    if (!isRecord(hooks)) continue;
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!isRecord(group)) continue;
        const rawMatcher = group["matcher"];
        const matcher = typeof rawMatcher === "string" ? rawMatcher : undefined;
        const commands = group["hooks"];
        if (!Array.isArray(commands)) continue;
        for (const hook of commands) {
          if (!isRecord(hook)) continue;
          const command = hook["command"];
          if (typeof command !== "string") continue;
          const timeout = hook["timeout"];
          const item: HookEntry = {
            path: entry.path,
            layer: entry.layer,
            event,
            command,
            firesOnEdit: firesOnEdit(event, matcher),
          };
          if (matcher !== undefined) item.matcher = matcher;
          if (typeof timeout === "number") item.timeoutSeconds = timeout;
          out.push(item);
        }
      }
    }
  }
  return out;
}
