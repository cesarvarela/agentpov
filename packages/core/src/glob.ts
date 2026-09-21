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
