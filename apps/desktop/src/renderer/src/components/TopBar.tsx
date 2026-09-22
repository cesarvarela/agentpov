import type { CSSProperties } from "react";

import {
  FolderIcon,
  LogoIcon,
  SidebarIcon,
  SidebarRightIcon,
} from "./Icons";

const DRAG = { WebkitAppRegion: "drag" } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as CSSProperties;

const AGENTS = ["Claude Code", "Codex", "Cursor", "Gemini CLI"] as const;

interface TopBarProps {
  appName: string;
  folder: string | null;
  folderLabel: string;
  isMac: boolean;
  sidebarCollapsed: boolean;
  sourceOpen: boolean;
  onOpenFolder: () => void;
  onToggleSidebar: () => void;
  onToggleSource: () => void;
}

export function TopBar({
  appName,
  folder,
  folderLabel,
  isMac,
  sidebarCollapsed,
  sourceOpen,
  onOpenFolder,
  onToggleSidebar,
  onToggleSource,
}: TopBarProps) {
  return (
    <header
      className="border-om-border bg-om-panel flex h-[52px] shrink-0 items-center gap-4 border-b px-4"
      style={{ ...DRAG, paddingLeft: isMac ? 96 : 16 }}
    >
      <div className="flex shrink-0 items-center gap-2">
        <LogoIcon className="text-om-amber" />
        <span className="text-[14px] font-semibold tracking-[-0.01em]">
          {appName}
        </span>
      </div>

      <div
        className="border-om-border bg-om-bg flex items-center gap-0.5 rounded-md border p-0.5"
        style={NO_DRAG}
      >
        {AGENTS.map((agent) => {
          const active = agent === "Claude Code" && Boolean(folder);
          return (
            <button
              key={agent}
              type="button"
              disabled={!active}
              title={
                agent === "Claude Code"
                  ? undefined
                  : `${agent} support is not built yet`
              }
              className={
                active
                  // Orange marks the agent whose context this is (Claude
                  // Code); amber stays agentview's own accent.
                  ? "bg-om-raised text-om-orange flex h-6 items-center rounded-[4px] px-2.5 text-xs font-medium"
                  : "text-om-muted flex h-6 cursor-default items-center rounded-[4px] px-2.5 text-xs opacity-70"
              }
            >
              <span>{agent}</span>
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 flex-1 items-center">
        <button
          type="button"
          onClick={onOpenFolder}
          title={folder ? "Open another folder" : "Open folder"}
          style={NO_DRAG}
          className="text-om-muted hover:text-om-text hover:bg-om-raised flex h-7 min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-md px-2 font-mono text-xs transition-colors"
        >
          <FolderIcon className="shrink-0" />
          <span className="truncate">{folder ? folderLabel : "Open folder…"}</span>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2" style={NO_DRAG}>
        <button
          type="button"
          onClick={onToggleSidebar}
          disabled={!folder}
          title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          aria-pressed={!sidebarCollapsed}
          className={`border-om-border flex size-7 items-center justify-center rounded-md border transition-colors disabled:cursor-default disabled:opacity-40 disabled:hover:text-om-muted ${
            sidebarCollapsed
              ? "bg-om-bg text-om-muted hover:text-om-text"
              : "bg-om-raised text-om-text"
          }`}
        >
          <SidebarIcon className="size-4" filled={!sidebarCollapsed} />
        </button>
        <button
          type="button"
          onClick={onToggleSource}
          disabled={!folder}
          title={sourceOpen ? "Hide source pane" : "Show source pane"}
          aria-label={sourceOpen ? "Hide source pane" : "Show source pane"}
          aria-pressed={sourceOpen}
          className={`border-om-border flex size-7 items-center justify-center rounded-md border transition-colors disabled:cursor-default disabled:opacity-40 disabled:hover:text-om-muted ${
            sourceOpen
              ? "bg-om-raised text-om-text"
              : "bg-om-bg text-om-muted hover:text-om-text"
          }`}
        >
          <SidebarRightIcon className="size-4" filled={sourceOpen} />
        </button>
      </div>
    </header>
  );
}
