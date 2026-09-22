import { useCallback, useRef, useState } from "react";

export interface PaneDefaults {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** Collapsed state to fall back to when nothing was persisted. */
  defaultCollapsed?: boolean;
}

export interface PaneState {
  /**
   * Width to open the pane at. Read once on mount and kept stable: it is handed
   * to allotment as `preferredSize`, and allotment itself remembers the live
   * width across a collapse, so re-rendering on every drag would only fight it.
   */
  initialWidth: number;
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
  /** Records a width the user dragged to, for the next launch. */
  recordWidth: (width: number) => void;
}

function persist(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode, disabled) — state stays in memory */
  }
}

/**
 * Width / collapsed state for one resizable pane, persisted in localStorage
 * under `agentview.<key>.width` and `agentview.<key>.collapsed`.
 */
export function usePanePersistence(key: string, defaults: PaneDefaults): PaneState {
  const { defaultWidth, minWidth, maxWidth, defaultCollapsed = false } = defaults;

  const widthKey = `agentview.${key}.width`;
  const collapsedKey = `agentview.${key}.collapsed`;

  const clamp = useCallback(
    (width: number) => Math.min(maxWidth, Math.max(minWidth, width)),
    [maxWidth, minWidth],
  );

  const initialWidth = useRef<number | null>(null);
  if (initialWidth.current === null) {
    let width = defaultWidth;
    try {
      const raw = window.localStorage.getItem(widthKey);
      const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) width = clamp(parsed);
    } catch {
      /* storage unavailable — fall back to the default width */
    }
    initialWidth.current = width;
  }

  const [collapsed, setCollapsedState] = useState(() => {
    try {
      const raw = window.localStorage.getItem(collapsedKey);
      return raw === null ? defaultCollapsed : raw === "true";
    } catch {
      return defaultCollapsed;
    }
  });

  const setCollapsed = useCallback(
    (next: boolean) => {
      setCollapsedState((previous) => {
        if (previous !== next) persist(collapsedKey, String(next));
        return next;
      });
    },
    [collapsedKey],
  );

  const toggle = useCallback(() => {
    setCollapsedState((previous) => {
      persist(collapsedKey, String(!previous));
      return !previous;
    });
  }, [collapsedKey]);

  const recordWidth = useCallback(
    (next: number) => {
      if (next < minWidth) return;
      persist(widthKey, String(clamp(Math.round(next))));
    },
    [clamp, minWidth, widthKey],
  );

  return {
    initialWidth: initialWidth.current,
    collapsed,
    toggle,
    setCollapsed,
    recordWidth,
  };
}
