import { JsonViewer } from "./JsonViewer";
import { MarkdownViewer } from "./MarkdownViewer";
import { McpViewer } from "./McpViewer";
import { SettingsViewer } from "./SettingsViewer";
import type { Viewer, ViewerKind } from "./types";

export type { Viewer, ViewerKind, ViewerProps } from "./types";

const SETTINGS_NAMES = new Set([
  "settings.json",
  "settings.local.json",
  "managed-settings.json",
]);

/**
 * Picks the rendered viewer for a file from its path alone.
 *
 * - Output styles, skills, agents and instruction files are Markdown.
 * - `managed-settings.d/*.json` drop-ins are settings files.
 * - A plugin's `hooks/hooks.json` has the same `hooks` shape as settings, so
 *   it gets the settings viewer's hook cards (and the clicked hook highlighted).
 * - Plugin manifests and marketplace/installed lists are plain JSON.
 * - Workflows (`.claude/workflows/*.js`) have no rendered view: numbered lines.
 */
export function viewerKindFor(path: string): ViewerKind {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1).toLowerCase();
  const parent = path.slice(path.lastIndexOf("/", slash - 1) + 1, slash);
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  if (SETTINGS_NAMES.has(name)) return "settings";
  if (name.endsWith(".json") && parent === "managed-settings.d") return "settings";
  if (name === "hooks.json" && parent === "hooks") return "settings";
  // `~/.claude.json` declares MCP servers too, at the root and per project.
  if (name === ".mcp.json" || name === ".claude.json") return "mcp";
  if (name.endsWith(".json")) return "json";
  return "text";
}

/** Rendered viewers by kind; `text` has none, the pane shows lines instead. */
export const VIEWERS: Record<Exclude<ViewerKind, "text">, Viewer> = {
  markdown: MarkdownViewer,
  settings: SettingsViewer,
  mcp: McpViewer,
  json: JsonViewer,
};
