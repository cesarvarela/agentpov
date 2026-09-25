import { useEffect, useRef, useState, type CSSProperties } from "react";

import { displayPath } from "../lib/paths";
import type { RecentProject } from "../lib/recents";
import { ChevronDownIcon, FolderIcon, ServerIcon } from "./Icons";

const NO_DRAG = { WebkitAppRegion: "no-drag" } as CSSProperties;

/** Recents shown in the menu, after leaving out the open project. */
const MENU_RECENTS = 8;

const localHome = window.agentview?.homeDir ?? "";

/** Square, outlined host tag; structure, not state, so it carries no color. */
export function HostBadge({ host, icon = true }: { host: string; icon?: boolean }) {
  return (
    <span className="border-om-border text-om-text flex shrink-0 items-center gap-1 rounded-[4px] border px-1.5 py-px font-mono text-[11px]">
      {icon ? <ServerIcon className="size-3" /> : null}
      {host}
    </span>
  );
}

export function recentLabel(entry: RecentProject): string {
  return displayPath(entry.path, null, entry.host ? (entry.homeDir ?? "") : localHome);
}

/**
 * One recent project as a row. The icon column has a fixed width so paths line
 * up; the host badge sits at the right edge.
 */
export function RecentRow({ entry }: { entry: RecentProject }) {
  const Icon = entry.host ? ServerIcon : FolderIcon;
  return (
    <>
      <Icon className="text-om-muted size-3.5 shrink-0" />
      <span className="min-w-0 truncate font-mono text-xs" title={entry.path}>
        {recentLabel(entry)}
      </span>
      {entry.host ? (
        <span className="ml-auto pl-2">
          <HostBadge host={entry.host} icon={false} />
        </span>
      ) : null}
    </>
  );
}

interface ProjectSwitcherProps {
  folder: string | null;
  host: string | null;
  folderLabel: string;
  recents: RecentProject[];
  opening: boolean;
  isMac: boolean;
  onOpenFolder: () => void;
  onOpenRemote: () => void;
  onOpenRecent: (entry: RecentProject) => void;
}

const ITEM =
  "hover:bg-om-raised focus:bg-om-raised flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-xs outline-none";

/**
 * The open project's location as one button; its menu opens a local folder,
 * a folder over SSH, or a recent project.
 */
export function ProjectSwitcher({
  folder,
  host,
  folderLabel,
  recents,
  opening,
  isMac,
  onOpenFolder,
  onOpenRemote,
  onOpenRecent,
}: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const others = recents
    .filter((r) => !(r.host === host && r.path === folder))
    .slice(0, MENU_RECENTS);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("[data-item]")?.focus();

    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[data-item]") ?? [])];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const mod = isMac ? "⌘" : "Ctrl+";

  return (
    <div ref={rootRef} className="relative min-w-0" style={NO_DRAG}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={folder ? "Switch project" : "Open a project"}
        className={`text-om-muted hover:text-om-text hover:bg-om-raised flex h-7 min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-md px-2 font-mono text-xs transition-colors ${
          open ? "bg-om-raised text-om-text" : ""
        }`}
      >
        {host ? <HostBadge host={host} /> : <FolderIcon className="shrink-0" />}
        <span className="truncate">
          {opening ? "Opening…" : folder ? folderLabel : "Open a project…"}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0" />
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          className="border-om-border bg-om-panel absolute left-0 top-[calc(100%+4px)] z-40 flex w-[360px] flex-col rounded-lg border p-1 shadow-2xl"
        >
          <button type="button" role="menuitem" data-item className={ITEM} onClick={pick(onOpenFolder)}>
            <FolderIcon className="text-om-muted size-3.5 shrink-0" />
            Open folder…
            <span className="text-om-muted ml-auto text-[11px]">{mod}O</span>
          </button>
          <button type="button" role="menuitem" data-item className={ITEM} onClick={pick(onOpenRemote)}>
            <ServerIcon className="text-om-muted size-3.5 shrink-0" />
            Open over SSH…
            <span className="text-om-muted ml-auto text-[11px]">
              {isMac ? "⇧⌘O" : "Ctrl+Shift+O"}
            </span>
          </button>

          {others.length > 0 ? (
            <>
              <div className="bg-om-border my-1 h-px" />
              <div className="text-om-muted px-2 pb-0.5 pt-1 text-[11px]">Recent</div>
              {others.map((entry) => (
                <button
                  key={`${entry.host ?? ""}\t${entry.path}`}
                  type="button"
                  role="menuitem"
                  data-item
                  className={ITEM}
                  onClick={pick(() => onOpenRecent(entry))}
                >
                  <RecentRow entry={entry} />
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
