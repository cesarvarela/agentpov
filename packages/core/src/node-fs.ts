import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { type FileSystemReader } from "./types.js";

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return (
    code === "ENOENT" ||
    code === "ENOTDIR" ||
    code === "EISDIR" ||
    code === "EACCES" ||
    code === "EPERM" ||
    code === "ELOOP" ||
    code === "ENAMETOOLONG"
  );
}

/** A `FileSystemReader` backed by the real filesystem. */
export function createNodeFileSystem(): FileSystemReader {
  return {
    async readFile(path: string): Promise<string | null> {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async readDir(path: string): Promise<{ name: string; isDirectory: boolean }[] | null> {
      try {
        const entries = await readdir(path, { withFileTypes: true });
        return Promise.all(
          entries.map(async (entry) => ({
            name: entry.name,
            // Claude Code follows symlinked skill and rule directories, so
            // a link counts as whatever it points at (a broken one as a file).
            isDirectory: entry.isSymbolicLink()
              ? await stat(join(path, entry.name)).then((info) => info.isDirectory(), () => false)
              : entry.isDirectory(),
          })),
        );
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async fileSize(path: string): Promise<number | null> {
      try {
        const info = await stat(path);
        return info.isFile() ? info.size : null;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
  };
}
