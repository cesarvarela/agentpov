import { useCallback, useState } from "react";
import type { ConfigLayer } from "@agentview/core";

/** A file the right-hand source pane is showing, plus what to highlight in it. */
export interface SourceTarget {
  /** Identity of the row that opened this source, for the selected style. */
  key: string;
  /** Absolute path of the file to show. */
  path: string;
  /** Config layer the file belongs to, when known. */
  layer?: ConfigLayer;
  /** 1-based line to highlight, when it is known up front. */
  line?: number;
  /**
   * Candidate substrings; the first line containing the first candidate that
   * hits anywhere in the file is highlighted. Used for rules and hook commands,
   * whose line number is only knowable once the file has been read.
   */
  matches?: string[];
  /** For imports: where the `@path` reference sits in the importing file. */
  importedAt?: { line: number; parent: string };
}

export interface SourceState {
  source: SourceTarget | null;
  /** Visited targets, oldest first; `index` points at the shown one. */
  entries: SourceTarget[];
  index: number;
  /** Whether the right-hand pane is visible. */
  open: boolean;
  openSource: (target: SourceTarget) => void;
  closeSource: () => void;
  toggle: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

/** How many targets the back/forward history keeps. */
const HISTORY_LIMIT = 50;

/** True when two targets show the same file scrolled to the same place. */
function sameSpot(a: SourceTarget, b: SourceTarget): boolean {
  if (a.path !== b.path) return false;
  if (a.line !== b.line) return false;
  const left = a.matches ?? [];
  const right = b.matches ?? [];
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/**
 * Which file the source pane shows, with browser-style back/forward history.
 * Deliberately independent of the selected tree file: picking another file in
 * the tree leaves the pane as it is.
 *
 * Closing keeps the history, so reopening the pane shows the last target again.
 */
export function useSource(): SourceState {
  const [history, setHistory] = useState<{
    entries: SourceTarget[];
    index: number;
  }>({ entries: [], index: -1 });
  const [open, setOpen] = useState(false);

  const openSource = useCallback((target: SourceTarget) => {
    setHistory(({ entries, index }) => {
      const current = entries[index];
      // Re-opening the same spot refreshes it in place, with no new entry.
      if (current && sameSpot(current, target)) {
        const replaced = [...entries];
        replaced[index] = target;
        return { entries: replaced, index };
      }
      // Opening from the middle of the history drops what came after it.
      const next = [...entries.slice(0, index + 1), target].slice(
        -HISTORY_LIMIT,
      );
      return { entries: next, index: next.length - 1 };
    });
    setOpen(true);
  }, []);

  const closeSource = useCallback(() => {
    setOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setOpen((value) => !value);
  }, []);

  const goBack = useCallback(() => {
    setHistory((state) =>
      state.index > 0 ? { ...state, index: state.index - 1 } : state,
    );
    setOpen(true);
  }, []);

  const goForward = useCallback(() => {
    setHistory((state) =>
      state.index < state.entries.length - 1
        ? { ...state, index: state.index + 1 }
        : state,
    );
    setOpen(true);
  }, []);

  const { entries, index } = history;

  return {
    source: entries[index] ?? null,
    entries,
    index,
    open,
    openSource,
    closeSource,
    toggle,
    canGoBack: index > 0,
    canGoForward: index < entries.length - 1,
    goBack,
    goForward,
  };
}
