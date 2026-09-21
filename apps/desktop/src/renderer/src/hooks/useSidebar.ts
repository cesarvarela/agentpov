import { useCallback, useRef, useState } from "react";

export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 520;

const WIDTH_KEY = "agentview.sidebar.width";
const COLLAPSED_KEY = "agentview.sidebar.collapsed";

function clampWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function readWidth(): number {
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? clampWidth(parsed) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function persist(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode, disabled) — state stays in memory */
  }
}

export interface SidebarState {
  /**
   * Width to open the sidebar at. Read once on mount and kept stable: it is
   * handed to allotment as `preferredSize`, and allotment itself remembers the
   * live width across a collapse, so re-rendering on every drag would only
   * fight it.
   */
  initialWidth: number;
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
  /** Records a width the user dragged to, for the next launch. */
  recordWidth: (width: number) => void;
}

/** Sidebar width / collapsed state, persisted in localStorage. */
export function useSidebar(): SidebarState {
  const initialWidth = useRef(readWidth());
  const [collapsed, setCollapsedState] = useState(readCollapsed);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState((previous) => {
      if (previous !== next) persist(COLLAPSED_KEY, String(next));
      return next;
    });
  }, []);

  const toggle = useCallback(() => {
    setCollapsedState((previous) => {
      persist(COLLAPSED_KEY, String(!previous));
      return !previous;
    });
  }, []);

  const recordWidth = useCallback((next: number) => {
    if (next < SIDEBAR_MIN_WIDTH) return;
    persist(WIDTH_KEY, String(clampWidth(Math.round(next))));
  }, []);

  return {
    initialWidth: initialWidth.current,
    collapsed,
    toggle,
    setCollapsed,
    recordWidth,
  };
}
