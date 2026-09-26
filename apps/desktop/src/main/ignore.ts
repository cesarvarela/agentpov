import { globToRegExp, type FileSystemReader } from "@agentpov/core";

import type { FileNode } from "../shared/ipc";

/** Per-project file listing paths the tree should hide, gitignore-style. */
export const IGNORE_FILE = ".agentpovignore";

interface IgnoreRule {
  regex: RegExp;
  /** Pattern had a `/` before its end, so it matches from the project root. */
  anchored: boolean;
  /** Pattern ended in `/`, so it only matches directories. */
  dirOnly: boolean;
  /** Pattern started with `!`: un-ignores what an earlier rule ignored. */
  negated: boolean;
}

/**
 * Parses `.agentpovignore`. A subset of gitignore: `#` comments, `!`
 * negation, a trailing `/` for directories only, and a `/` anywhere else
 * anchoring the pattern to the project root; without one it matches the name
 * at any depth. Globs are `*`, `**` and `?`.
 */
export function parseIgnore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const negated = line.startsWith("!");
    if (negated) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    line = line.replace(/\/+$/, "");
    const anchored = line.includes("/");
    line = line.replace(/^\/+/, "");
    if (line.length === 0) continue;

    rules.push({ regex: globToRegExp(line), anchored, dirOnly, negated });
  }
  return rules;
}

/** Whether `relPath` (project-relative, `/`-separated) is ignored. Last matching rule wins. */
export function isIgnored(rules: IgnoreRule[], relPath: string, isDir: boolean): boolean {
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.regex.test(rule.anchored ? relPath : name)) ignored = !rule.negated;
  }
  return ignored;
}

/**
 * Drops every node `.agentpovignore` in `folder` names from `tree`. An ignored
 * directory goes with everything under it, the way git treats it.
 */
export async function pruneIgnored(
  tree: FileNode,
  folder: string,
  fs: FileSystemReader,
): Promise<FileNode> {
  const sep = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  const text = await fs.readFile(`${folder.replace(/[\\/]+$/, "")}${sep}${IGNORE_FILE}`);
  if (!text) return tree;
  const rules = parseIgnore(text);
  if (rules.length === 0) return tree;

  const prefix = folder.replace(/[\\/]+$/, "").length + 1;
  const prune = (node: FileNode): FileNode => {
    if (!node.children) return node;
    const children = node.children
      .filter((child) => {
        const relPath = child.path.slice(prefix).replaceAll("\\", "/");
        return !isIgnored(rules, relPath, child.kind === "dir");
      })
      .map(prune);
    return { ...node, children };
  };
  return prune(tree);
}
