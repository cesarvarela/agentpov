/**
 * A small gitignore-flavoured glob matcher.
 *
 * Supported: `**` (any characters, crossing `/`), `*` (any characters except
 * `/`), `?` (one character except `/`). Everything else is literal.
 */

function escapeLiteral(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

export function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]!;
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        // `**`
        i += 1;
        if (pattern[i + 1] === "/") {
          i += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeLiteral(char);
  }
  return new RegExp(`^${source}$`);
}

/**
 * True when `target` matches `pattern`. A pattern without wildcards also
 * matches anything underneath it, so `src` matches `src/api/payments.ts`.
 */
export function matchGlob(pattern: string, target: string): boolean {
  const cleanPattern = pattern.replace(/\/+$/, "");
  const cleanTarget = target.replace(/\/+$/, "");
  if (cleanPattern.length === 0) return false;
  if (globToRegExp(cleanPattern).test(cleanTarget)) return true;
  // Directory-prefix match: `src` (or `src/**`-less patterns) covers its files.
  if (!/[*?]/.test(cleanPattern)) {
    return cleanTarget.startsWith(`${cleanPattern}/`);
  }
  return false;
}

/** Splits a path into segments, treating `""` as "no segments" (the root). */
function segmentsOf(value: string): string[] {
  const clean = value.replace(/\/+$/, "");
  return clean.length === 0 ? [] : clean.split("/");
}

/**
 * Could `pattern` match anything at or below `dir`?
 *
 * Both are compared in the same space: either both absolute, or both relative
 * to the project root (where `dir` is `""` for the root itself).
 *
 * The comparison walks the two segment lists side by side:
 *
 * - run out of directory segments → every remaining pattern segment sits
 *   inside `dir`, so the pattern covers something in it (`src/**` vs `src`,
 *   `src/api/*.ts` vs `src`);
 * - hit a `**` in the pattern → it spans any number of segments, so anything
 *   below this point can match (`**\/*.ts` vs `src/api`);
 * - run out of pattern segments while the directory goes deeper → the pattern
 *   is shallower than `dir` and cannot reach into it (`src/api.ts` vs
 *   `src/api`; a wildcard-free ancestor like `src` is already handled by
 *   `matchGlob`'s directory-prefix rule);
 * - otherwise the segments must match one-for-one as single-segment globs
 *   (`packages/*\/src` vs `packages/core`).
 */
export function globCoversDirectory(pattern: string, dir: string): boolean {
  // The glob naming the folder itself, or a wildcard-free ancestor of it.
  if (matchGlob(pattern, dir)) return true;

  const patternSegments = segmentsOf(pattern);
  const dirSegments = segmentsOf(dir);

  for (let i = 0; i < dirSegments.length; i += 1) {
    const segment = patternSegments[i];
    if (segment === undefined) return false;
    if (segment === "**") return true;
    if (!globToRegExp(segment).test(dirSegments[i]!)) return false;
  }
  // Every directory segment was consumed; whatever the pattern has left over
  // describes paths inside `dir`.
  return true;
}
