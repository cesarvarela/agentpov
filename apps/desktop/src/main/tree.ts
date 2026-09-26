import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import type { FileMark, FileNode } from "../shared/ipc";

/** Directories that never carry agent context and only add noise. */
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".turbo",
  ".next",
]);

/** How deep below the project root we walk. */
export const MAX_DEPTH = 6;

/** Marks a node carries purely from its name. */
export function marksForName(name: string, kind: "file" | "dir"): FileMark[] {
  const marks: FileMark[] = [];

  if (kind === "dir") {
    if (name === ".claude") marks.push("instructions");
    return marks;
  }

  if (name === "CLAUDE.md" || name === "CLAUDE.local.md" || name === "AGENTS.md") {
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

/**
 * Project tree from a flat list of absolute paths, as returned by a remote
 * `find`. Paths use `/`; directories at the depth cap get no children, the
 * same as `listTree`.
 */
export function buildTree(
  folder: string,
  entries: { path: string; isDirectory: boolean }[],
  maxDepth: number,
): FileNode {
  const root: FileNode = {
    name: folder.split("/").pop() || folder,
    path: folder,
    kind: "dir",
    marks: [],
    children: [],
  };
  const dirs = new Map<string, FileNode>([[folder, root]]);
  const prefix = folder === "/" ? "/" : `${folder}/`;

  // Parents sort before their children, so every parent exists when needed.
  const sorted = entries
    .filter((entry) => entry.path.startsWith(prefix))
    .sort((a, b) => a.path.length - b.path.length);

  for (const entry of sorted) {
    const slash = entry.path.lastIndexOf("/");
    const parent = dirs.get(slash === 0 ? "/" : entry.path.slice(0, slash));
    if (!parent?.children) continue;
    const name = entry.path.slice(slash + 1);
    const kind = entry.isDirectory ? "dir" : "file";
    const node: FileNode = { name, path: entry.path, kind, marks: marksForName(name, kind) };
    if (entry.isDirectory) {
      node.children = [];
      const depth = entry.path.slice(prefix.length).split("/").length;
      if (depth < maxDepth) dirs.set(entry.path, node);
    }
    parent.children.push(node);
  }

  for (const node of dirs.values()) node.children?.sort(compareNodes);
  return root;
}
