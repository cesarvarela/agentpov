import type { ComponentType } from "react";

/**
 * Which rendered view a file gets in the source pane. `text` means the plain
 * numbered-line view only; every other kind also offers a rendered view.
 */
export type ViewerKind = "markdown" | "settings" | "mcp" | "json" | "text";

/** Props every rendered viewer receives from the source pane. */
export interface ViewerProps {
  /** Absolute path of the file being shown. */
  path: string;
  /** Full file contents (possibly truncated at 200 KB upstream). */
  content: string;
  /** Project folder, for printing project-relative paths. */
  folder: string;
  /** Home directory, for printing `~/...` paths. */
  homeDir: string;
  /**
   * Substrings identifying the row that opened this file (a hook command, a
   * permission rule). A viewer that can locate the matching element should
   * highlight it and scroll it into view; otherwise ignore.
   */
  matches?: string[];
  /** 1-based line the opener asked for, when known. */
  line?: number;
  /** Open another file in the pane, e.g. an `@import` or a hook script. */
  onOpenPath: (path: string, line?: number) => void;
}

export type Viewer = ComponentType<ViewerProps>;
