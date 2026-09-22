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

/** Picks the rendered viewer for a file from its name alone. */
export function viewerKindFor(path: string): ViewerKind {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  if (SETTINGS_NAMES.has(name)) return "settings";
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
