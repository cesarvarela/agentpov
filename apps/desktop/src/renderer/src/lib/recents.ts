/** A folder opened before: local when `host` is null, otherwise on that SSH host. */
export interface RecentProject {
  host: string | null;
  /** Absolute path (remote paths are absolute on the remote machine). */
  path: string;
  /** Remote home directory, so the path can be shown as `~/…`. */
  homeDir?: string;
}

const KEY = "agentpov.recent";
const MAX = 10;

function sameProject(a: RecentProject, b: RecentProject): boolean {
  return a.host === b.host && a.path === b.path;
}

export function loadRecents(): RecentProject[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RecentProject =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as RecentProject).path === "string" &&
        ((entry as RecentProject).host === null ||
          typeof (entry as RecentProject).host === "string"),
    );
  } catch {
    return [];
  }
}

/** Moves `entry` to the front and returns the new list. */
export function rememberRecent(entry: RecentProject): RecentProject[] {
  const next = [entry, ...loadRecents().filter((r) => !sameProject(r, entry))].slice(0, MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Recents are a convenience; ignore storage failures.
  }
  return next;
}
