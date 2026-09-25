import type { CSSProperties } from "react";

import type { RecentProject } from "../lib/recents";
import {
  LogoIcon,
  SidebarIcon,
  SidebarRightIcon,
} from "./Icons";
import { ProjectSwitcher } from "./ProjectSwitcher";

const DRAG = { WebkitAppRegion: "drag" } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as CSSProperties;

const AGENTS = ["Claude Code", "Codex", "Cursor", "Gemini CLI"] as const;

interface TopBarProps {
  appName: string;
  folder: string | null;
  /** SSH host of the open folder, or null for a local one. */
  host: string | null;
  folderLabel: string;
  recents: RecentProject[];
  /** A recent project is being opened. */
  opening: boolean;
  isMac: boolean;
  sidebarCollapsed: boolean;
  sourceOpen: boolean;
  onOpenFolder: () => void;
  onOpenRemote: () => void;
  onOpenRecent: (entry: RecentProject) => void;
  onToggleSidebar: () => void;
  onToggleSource: () => void;
}

export function TopBar({
  appName,
  folder,
  host,
  folderLabel,
  recents,
  opening,
  isMac,
  sidebarCollapsed,
  sourceOpen,
  onOpenFolder,
  onOpenRemote,
  onOpenRecent,
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
                  // Code); amber stays agentpov's own accent.
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
        <ProjectSwitcher
          folder={folder}
          host={host}
          folderLabel={folderLabel}
          recents={recents}
          opening={opening}
          isMac={isMac}
          onOpenFolder={onOpenFolder}
          onOpenRemote={onOpenRemote}
          onOpenRecent={onOpenRecent}
        />
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
