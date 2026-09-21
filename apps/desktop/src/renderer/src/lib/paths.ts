import type { FileNode } from "../../../shared/ipc";

export function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) return "/";
  return path.slice(0, index);
}

/** `path` relative to `folder`, or null when it is outside the folder. */
export function relativeTo(path: string, folder: string): string | null {
  if (path === folder) return "";
  if (path.startsWith(`${folder}/`)) return path.slice(folder.length + 1);
  return null;
}

/**
 * Human path: relative to the open folder when inside it, `~/...` when inside
 * the home directory, absolute otherwise.
 */
export function displayPath(
  path: string,
  folder: string | null,
  homeDir: string,
): string {
  if (folder) {
    const rel = relativeTo(path, folder);
    if (rel !== null) return rel === "" ? basename(folder) : rel;
  }
  if (homeDir && (path === homeDir || path.startsWith(`${homeDir}/`))) {
    return `~${path.slice(homeDir.length)}`;
  }
  return path;
}

/** Same as `displayPath` but keeps the project folder name as a prefix. */
export function projectPath(
  path: string,
  folder: string | null,
  homeDir: string,
): string {
  if (folder) {
    const rel = relativeTo(path, folder);
    if (rel !== null && rel !== "") return `${basename(folder)}/${rel}`;
  }
  return displayPath(path, folder, homeDir);
}

const LANGUAGES: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  json: "JSON",
  jsonc: "JSON",
  md: "Markdown",
  mdx: "MDX",
  css: "CSS",
  scss: "Sass",
  html: "HTML",
  py: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  hpp: "C++",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  yml: "YAML",
  yaml: "YAML",
  toml: "TOML",
  sql: "SQL",
  prisma: "Prisma",
  graphql: "GraphQL",
  env: "Dotenv",
  txt: "Text",
};

export function languageOf(name: string): string {
  if (name === "Dockerfile") return "Docker";
  if (name.startsWith(".env")) return "Dotenv";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "Text";
  const ext = name.slice(dot + 1).toLowerCase();
  return LANGUAGES[ext] ?? ext.toUpperCase();
}

export function formatBytes(bytes: number | undefined): string | null {
  if (bytes === undefined) return null;
  if (bytes < 100) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function countNodes(node: FileNode): number {
  let total = 1;
  for (const child of node.children ?? []) total += countNodes(child);
  return total;
}

/** Directories on the path from the root down to `target`, for auto-expansion. */
export function ancestorDirs(target: string, folder: string): string[] {
  const rel = relativeTo(target, folder);
  if (rel === null) return [folder];
  const dirs = [folder];
  const parts = rel.split("/");
  let current = folder;
  for (const part of parts.slice(0, -1)) {
    current = `${current}/${part}`;
    dirs.push(current);
  }
  return dirs;
}
