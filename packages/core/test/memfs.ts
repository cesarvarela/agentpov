import { type FileSystemReader } from "../src/index.js";

/**
 * Builds a `FileSystemReader` over a flat `path → contents` map. Directories
 * are inferred from the file paths; everything is posix.
 */
export function memfs(files: Record<string, string>): FileSystemReader {
  const normalised = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    normalised.set(normalise(path), content);
  }

  const directories = new Map<string, Map<string, boolean>>();
  const ensureDir = (dir: string): Map<string, boolean> => {
    let entries = directories.get(dir);
    if (!entries) {
      entries = new Map<string, boolean>();
      directories.set(dir, entries);
    }
    return entries;
  };

  for (const path of normalised.keys()) {
    let child = path;
    let isDirectory = false;
    while (true) {
      const slash = child.lastIndexOf("/");
      if (slash < 0) break;
      const parent = slash === 0 ? "/" : child.slice(0, slash);
      const name = child.slice(slash + 1);
      if (name.length === 0) break;
      const entries = ensureDir(parent);
      entries.set(name, entries.get(name) === true || isDirectory);
      isDirectory = true;
      child = parent;
      if (parent === "/") break;
    }
  }

  return {
    async readFile(path: string): Promise<string | null> {
      return normalised.get(normalise(path)) ?? null;
    },
    async readDir(path: string): Promise<{ name: string; isDirectory: boolean }[] | null> {
      const entries = directories.get(normalise(path));
      if (!entries) return null;
      return [...entries].map(([name, isDirectory]) => ({ name, isDirectory }));
    },
    async fileSize(path: string): Promise<number | null> {
      const content = normalised.get(normalise(path));
      if (content === undefined) return null;
      return new TextEncoder().encode(content).length;
    },
  };
}

function normalise(path: string): string {
  const collapsed = path.replace(/\/+/g, "/");
  return collapsed.length > 1 && collapsed.endsWith("/")
    ? collapsed.slice(0, -1)
    : collapsed;
}
