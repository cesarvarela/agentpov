import nodePath from "node:path";

/** The subset of `node:path` the resolver uses, bound to a platform. */
export type PathApi = nodePath.PlatformPath;

export function pathFor(platform: NodeJS.Platform): PathApi {
  return platform === "win32" ? nodePath.win32 : nodePath.posix;
}

/** Normalise a path and drop any trailing separator (except for a root). */
export function tidy(p: PathApi, value: string): string {
  const normalised = p.normalize(value);
  if (normalised.length > 1 && normalised.endsWith(p.sep)) {
    const trimmed = normalised.slice(0, -1);
    return trimmed.length === 0 ? normalised : trimmed;
  }
  return normalised;
}

/** Resolve `value` against `base` without ever consulting `process.cwd()`. */
export function toAbsolute(p: PathApi, base: string, value: string): string {
  if (p.isAbsolute(value)) return tidy(p, value);
  return tidy(p, p.join(base, value));
}

/** Always-posix form of a path, for glob matching. */
export function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

/** Directories from `folder` (exclusive) down to `dir` (inclusive). */
export function descendingChain(p: PathApi, folder: string, dir: string): string[] {
  const chain: string[] = [];
  let current = tidy(p, dir);
  const root = tidy(p, folder);
  const seen = new Set<string>();
  while (current !== root && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    const parent = p.dirname(current);
    if (parent === current) return []; // `dir` is not under `folder`
    current = parent;
  }
  if (current !== root) return [];
  return chain.reverse();
}
