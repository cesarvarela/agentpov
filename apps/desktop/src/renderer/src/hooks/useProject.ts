import { useCallback, useEffect, useRef, useState } from "react";

import type { FileNode, ResolvedContext, TargetKind } from "../../../shared/ipc";
import { ancestorDirs } from "../lib/paths";

export interface FileDetail {
  lines: number;
  bytes: number;
  truncated: boolean;
}

/** The tree row whose context is on screen: a file or a folder. */
export interface SelectedTarget {
  /** Absolute path. */
  path: string;
  kind: TargetKind;
}

export interface Project {
  folder: string | null;
  tree: FileNode | null;
  /** Resolution target; the project root right after a folder is opened. */
  target: SelectedTarget | null;
  context: ResolvedContext | null;
  /** Line and byte counts, for a file target only. */
  detail: FileDetail | null;
  expanded: Set<string>;
  loading: boolean;
  error: string | null;
  openFolder: () => Promise<void>;
  select: (path: string, kind: TargetKind) => void;
  toggleDir: (path: string) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useProject(): Project {
  const api = window.agentview;

  const [folder, setFolder] = useState<string | null>(null);
  const [tree, setTree] = useState<FileNode | null>(null);
  const [target, setTarget] = useState<SelectedTarget | null>(null);
  const [context, setContext] = useState<ResolvedContext | null>(null);
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Guards against out-of-order responses when clicking quickly. */
  const requestId = useRef(0);

  const openFolder = useCallback(async () => {
    if (!api) return;
    try {
      const picked = await api.openFolder();
      if (!picked) return;
      setError(null);
      setFolder(picked);
      // Nothing is selected yet, so the project root is the target.
      setTarget({ path: picked, kind: "directory" });
      setContext(null);
      setDetail(null);
      setTree(null);
      const next = await api.listTree(picked);
      setTree(next);
      setExpanded(new Set([picked, ...(next.children ?? []).map((c) => c.path)]));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [api]);

  const select = useCallback(
    (path: string, kind: TargetKind) => {
      setTarget({ path, kind });
      if (folder) {
        setExpanded((previous) => {
          const next = new Set(previous);
          for (const dir of ancestorDirs(path, folder)) next.add(dir);
          return next;
        });
      }
    },
    [folder],
  );

  const toggleDir = useCallback((path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!api || !folder || !target) {
      setContext(null);
      setDetail(null);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);

    void (async () => {
      try {
        const [resolved, file] = await Promise.all([
          api.resolveContext(folder, target.path, target.kind),
          target.kind === "file"
            ? api.readFile(target.path).catch(() => null)
            : null,
        ]);
        if (id !== requestId.current) return;
        setContext(resolved);
        setDetail(
          file
            ? {
                lines: file.content === "" ? 0 : file.content.split("\n").length,
                bytes: file.bytes,
                truncated: file.truncated,
              }
            : null,
        );
        setError(null);
      } catch (cause) {
        if (id !== requestId.current) return;
        setContext(null);
        setDetail(null);
        setError(errorMessage(cause));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    })();
  }, [api, folder, target]);

  return {
    folder,
    tree,
    target,
    context,
    detail,
    expanded,
    loading,
    error,
    openFolder,
    select,
    toggleDir,
  };
}
