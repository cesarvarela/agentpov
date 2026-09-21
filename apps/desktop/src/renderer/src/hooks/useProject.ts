import { useCallback, useEffect, useRef, useState } from "react";

import type { FileNode, ResolvedContext } from "../../../shared/ipc";
import { ancestorDirs } from "../lib/paths";

export interface FileDetail {
  lines: number;
  bytes: number;
  truncated: boolean;
}

export interface Project {
  folder: string | null;
  tree: FileNode | null;
  selected: string | null;
  context: ResolvedContext | null;
  detail: FileDetail | null;
  expanded: Set<string>;
  loading: boolean;
  error: string | null;
  openFolder: () => Promise<void>;
  selectFile: (path: string) => void;
  toggleDir: (path: string) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useProject(): Project {
  const api = window.agentview;

  const [folder, setFolder] = useState<string | null>(null);
  const [tree, setTree] = useState<FileNode | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
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
      setSelected(null);
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

  const selectFile = useCallback(
    (path: string) => {
      setSelected(path);
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
    if (!api || !folder || !selected) {
      setContext(null);
      setDetail(null);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);

    void (async () => {
      try {
        const [resolved, file] = await Promise.all([
          api.resolveContext(folder, selected),
          api.readFile(selected).catch(() => null),
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
  }, [api, folder, selected]);

  return {
    folder,
    tree,
    selected,
    context,
    detail,
    expanded,
    loading,
    error,
    openFolder,
    selectFile,
    toggleDir,
  };
}
