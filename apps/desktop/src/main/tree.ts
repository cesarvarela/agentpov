import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import type { FileMark, FileNode } from "../shared/ipc";

/** Directories that never carry agent context and only add noise. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".turbo",
  ".next",
]);

/** How deep below the project root we walk. */
const MAX_DEPTH = 6;

/** Marks a node carries purely from its name. */
export function marksForName(name: string, kind: "file" | "dir"): FileMark[] {
  const marks: FileMark[] = [];

  if (kind === "dir") {
    if (name === ".claude") marks.push("instructions");
    return marks;
  }

  if (name === "CLAUDE.md" || name === "CLAUDE.local.md") {
    marks.push("instructions");
  } else if (name.startsWith("settings") && name.endsWith(".json")) {
    marks.push("instructions");
  } else if (name === ".mcp.json") {
    marks.push("mcp");
  }

  return marks;
}

function compareNodes(a: FileNode, b: FileNode): number {
  if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}

async function walk(dir: string, depth: number): Promise<FileNode[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileNode[] = [];

  for (const entry of entries) {
    const isDir = entry.isDirectory();
    if (!isDir && !entry.isFile()) continue;
    if (isDir && SKIP_DIRS.has(entry.name)) continue;

    const path = join(dir, entry.name);
    const kind = isDir ? "dir" : "file";
    const node: FileNode = {
      name: entry.name,
      path,
      kind,
      marks: marksForName(entry.name, kind),
    };

    if (isDir && depth < MAX_DEPTH) {
      node.children = await walk(path, depth + 1);
    } else if (isDir) {
      node.children = [];
    }

    nodes.push(node);
  }

  return nodes.sort(compareNodes);
}

/** Recursive project tree rooted at `folder`. */
export async function listTree(folder: string): Promise<FileNode> {
  return {
    name: basename(folder) || folder,
    path: folder,
    kind: "dir",
    marks: [],
    children: await walk(folder, 1),
  };
}
