/** A frontmatter value: a scalar, or a list (`- item` lines or `[a, b]`). */
export type FrontmatterValue = string | string[];

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
    (value.startsWith("'") && value.endsWith("'") && value.length > 1)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Splits `[a, "b, c"]` into its elements, respecting quotes. */
function parseInlineList(value: string): string[] {
  const inner = value.slice(1, -1);
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of inner) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ",") {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  items.push(current.trim());
  return items.filter((item) => item.length > 0);
}

/**
 * The YAML frontmatter fields skills, agents and rules actually use: top-level
 * scalars, plus top-level lists written either as `- item` lines or inline as
 * `[a, b]`. Nested maps are still ignored.
 */
export function parseFrontmatterFields(
  content: string,
): Record<string, FrontmatterValue> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return {};
  const body = match[1] ?? "";
  const values: Record<string, FrontmatterValue> = {};
  // The key a bare `- item` line belongs to, i.e. the last key whose value was
  // left empty.
  let listKey: string | null = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("-")) {
      const item = unquote(trimmed.replace(/^-\s*/, "").trim());
      if (listKey === null || item.length === 0) continue;
      const existing = values[listKey];
      if (Array.isArray(existing)) existing.push(item);
      else values[listKey] = [item];
      continue;
    }

    if (/^\s/.test(rawLine)) continue; // nested value; not needed here

    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();

    if (rawValue.length === 0) {
      // Either a list written over the following lines, or an empty value.
      listKey = key;
      continue;
    }
    listKey = null;
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      values[key] = parseInlineList(rawValue);
      continue;
    }
    values[key] = unquote(rawValue);
  }
  return values;
}

/** The scalar frontmatter fields only; lists are left out. */
export function parseFrontmatter(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parseFrontmatterFields(content))) {
    if (typeof value === "string" && value.length > 0) values[key] = value;
  }
  return values;
}

/** A frontmatter field read as a list, whether it was written as one or not. */
export function frontmatterList(
  fields: Record<string, FrontmatterValue>,
  key: string,
): string[] {
  const value = fields[key];
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((item) => item.length > 0);
  return value.length > 0 ? [value] : [];
}
