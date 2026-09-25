import { useCallback, useEffect, useRef, useState } from "react";

import type { FileNode, ResolvedContext, TargetKind } from "../../../shared/ipc";
import { errorMessage } from "../lib/errors";
import { ancestorDirs } from "../lib/paths";
import { loadRecents, rememberRecent, type RecentProject } from "../lib/recents";

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
  /** SSH host the folder lives on, or null for a local folder. */
  host: string | null;
  /** Home directory on the machine the folder lives on, for `~/` paths. */
  homeDir: string;
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
  /** Opens `path` on an SSH host; rejects when it is not a folder. */
  openRemote: (host: string, path: string) => Promise<void>;
  /** Folders opened before, most recent first; includes the open one. */
  recents: RecentProject[];
  /** Reopens a recent folder directly, connecting to its host if needed. */
  openRecent: (entry: RecentProject) => Promise<void>;
  /** True while a folder is being opened (connecting, listing its tree). */
  opening: boolean;
  select: (path: string, kind: TargetKind) => void;
  toggleDir: (path: string) => void;
}


export function useProject(): Project {
  const api = window.agentview;

  const [folder, setFolder] = useState<string | null>(null);
  const [host, setHost] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState(api?.homeDir ?? "");
  const [recents, setRecents] = useState<RecentProject[]>(loadRecents);
  const [opening, setOpening] = useState(false);
  const [tree, setTree] = useState<FileNode | null>(null);
  const [target, setTarget] = useState<SelectedTarget | null>(null);
  const [context, setContext] = useState<ResolvedContext | null>(null);
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Guards against out-of-order responses when clicking quickly. */
  const requestId = useRef(0);

  /** Shows `root` with the project root as the target, then loads its tree. */
  const load = useCallback(
    async (root: string) => {
      if (!api) return;
      setError(null);
      setFolder(root);
      // Nothing is selected yet, so the project root is the target.
      setTarget({ path: root, kind: "directory" });
      setContext(null);
      setDetail(null);
      setTree(null);
      // The context effect only starts after this render; show it as loading now.
      setLoading(true);
      const next = await api.listTree(root);
      setTree(next);
      setExpanded(new Set([root, ...(next.children ?? []).map((c) => c.path)]));
    },
    [api],
  );

  const openFolder = useCallback(async () => {
    if (!api) return;
    try {
      const picked = await api.openFolder();
      if (!picked) return;
      setHost(null);
      setHomeDir(api.homeDir);
      setRecents(rememberRecent({ host: null, path: picked }));
      await load(picked);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [api, load]);

  const openRemote = useCallback(
    async (remoteHost: string, path: string) => {
      if (!api) return;
      // Rejections before the switch stay with the caller (the remote dialog).
      const opened = await api.openRemoteFolder(remoteHost, path);
      setHost(opened.host);
      setHomeDir(opened.homeDir);
      setRecents(
        rememberRecent({
          host: opened.host,
          path: opened.folder,
          homeDir: opened.homeDir,
        }),);
      try {
        await load(opened.folder);
      } catch (cause) {
        setError(errorMessage(cause));
      }
    },
    [api, load],
  );

  const openRecent = useCallback(
    async (entry: RecentProject) => {
      if (!api) return;
      setOpening(true);
      try {
        if (entry.host) {
          await openRemote(entry.host, entry.path);
        } else {
          const path = await api.openLocalFolder(entry.path);
          setHost(null);
          setHomeDir(api.homeDir);
          setRecents(rememberRecent({ host: null, path }));
          await load(path);
        }
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setOpening(false);
      }
    },
    [api, load, openRemote],
  );

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
    host,
    homeDir,
    tree,
    target,
    context,
    detail,
    expanded,
    loading,
    error,
    openFolder,
    openRemote,
    recents,
    openRecent,
    opening,
    select,
    toggleDir,
  };
}
