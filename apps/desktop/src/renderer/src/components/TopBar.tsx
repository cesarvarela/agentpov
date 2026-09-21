import type { CSSProperties } from "react";

import {
  FolderIcon,
  FolderPlusIcon,
  LogoIcon,
  SidebarIcon,
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
  onOpenFolder: () => void;
  onToggleSidebar: () => void;
}

export function TopBar({
  appName,
  folder,
  folderLabel,
  isMac,
  sidebarCollapsed,
  onOpenFolder,
  onToggleSidebar,
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
          const active = agent === "Claude Code";
          return (
            <button
              key={agent}
              type="button"
              disabled={!active}
              title={active ? undefined : `${agent} support is not built yet`}
              className={
                active
                  ? "bg-om-raised text-om-amber flex h-6 items-center rounded-[4px] px-2.5 text-xs font-medium"
                  : "text-om-muted flex h-6 cursor-default items-center rounded-[4px] px-2.5 text-xs opacity-70"
              }
            >
              <span>{agent}</span>
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <FolderIcon className="text-om-muted shrink-0" />
        <span className="text-om-muted truncate font-mono text-xs">
          {folder ? folderLabel : "no folder open"}
        </span>
        <button
          type="button"
          onClick={onOpenFolder}
          title="Open folder"
          aria-label="Open folder"
          style={NO_DRAG}
          className="border-om-border bg-om-bg text-om-muted hover:text-om-text hover:bg-om-raised flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors"
        >
          <FolderPlusIcon className="size-4" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2" style={NO_DRAG}>
        <button
          type="button"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          aria-pressed={!sidebarCollapsed}
          className={`border-om-border flex size-7 items-center justify-center rounded-md border transition-colors ${
            sidebarCollapsed
              ? "bg-om-bg text-om-muted hover:text-om-text"
              : "bg-om-raised text-om-text"
          }`}
        >
          <SidebarIcon className="size-4" filled={!sidebarCollapsed} />
        </button>
      </div>
    </header>
  );
}
