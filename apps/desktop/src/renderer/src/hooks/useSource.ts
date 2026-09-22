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
  /** Whether the right-hand pane is visible. */
  open: boolean;
  openSource: (target: SourceTarget) => void;
  closeSource: () => void;
  toggle: () => void;
}

/**
 * Which file the source pane shows. Deliberately independent of the selected
 * tree file: picking another file in the tree leaves the pane as it is.
 *
 * Closing keeps the last target, so reopening the pane shows it again.
 */
export function useSource(): SourceState {
  const [source, setSource] = useState<SourceTarget | null>(null);
  const [open, setOpen] = useState(false);

  const openSource = useCallback((target: SourceTarget) => {
    setSource(target);
    setOpen(true);
  }, []);

  const closeSource = useCallback(() => {
    setOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setOpen((value) => !value);
  }, []);

  return { source, open, openSource, closeSource, toggle };
}
