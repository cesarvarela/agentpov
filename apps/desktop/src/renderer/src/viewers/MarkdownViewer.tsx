import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { dirname } from "../lib/paths";
import type { ViewerProps } from "./types";

/* ------------------------------------------------------------------ *
 * Frontmatter
 *
 * A local, deliberately small mirror of `parseFrontmatterFields` in
 * packages/core/src/frontmatter.ts: top-level scalars, `- item` lists and
 * inline `[a, b]` lists. Nested maps are ignored, as they are there.
 * ------------------------------------------------------------------ */

type FieldValue = string | string[];

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function unquote(value: string): string {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  return quoted && value.length > 1 ? value.slice(1, -1) : value;
}

/** Splits `[a, "b, c"]` into its elements, respecting quotes. */
function parseInlineList(value: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of value.slice(1, -1)) {
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

function parseFields(body: string): [string, FieldValue][] {
  const order: string[] = [];
  const values = new Map<string, FieldValue>();
  let listKey: string | null = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("-")) {
      const item = unquote(trimmed.replace(/^-\s*/, "").trim());
      if (listKey === null || item.length === 0) continue;
      const existing = values.get(listKey);
      if (Array.isArray(existing)) existing.push(item);
      else values.set(listKey, [item]);
      continue;
    }

    if (/^\s/.test(rawLine)) continue; // nested value; not shown

    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!values.has(key)) order.push(key);

    if (rawValue.length === 0) {
      listKey = key;
      values.set(key, "");
      continue;
    }
    listKey = null;
    values.set(
      key,
      rawValue.startsWith("[") && rawValue.endsWith("]")
        ? parseInlineList(rawValue)
        : unquote(rawValue),
    );
  }

  return order
    .map((key) => [key, values.get(key) ?? ""] as [string, FieldValue])
    .filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : value.length > 0,
    );
}

/** Splits a leading `---` block off the content. */
function splitFrontmatter(content: string): {
  fields: [string, FieldValue][];
  body: string;
} {
  const match = FRONTMATTER.exec(content);
  if (!match) return { fields: [], body: content };
  return {
    fields: parseFields(match[1] ?? ""),
    body: content.slice(match[0].length),
  };
}

function FrontmatterTable({ fields }: { fields: [string, FieldValue][] }) {
  return (
    <dl className="border-om-border grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b px-3 py-2 text-[12px]">
      {fields.map(([key, value]) => (
        <div key={key} className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-om-muted font-mono">{key}</dt>
          <dd className="min-w-0">
            {Array.isArray(value) ? (
              <span className="flex flex-wrap gap-1">
                {value.map((item) => (
                  <span
                    key={item}
                    className="border-om-border bg-om-raised text-om-text rounded-full border px-1.5 py-px font-mono text-[11px]"
                  >
                    {item}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-om-text font-mono break-words">
                {value}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ *
 * `@import` references
 * ------------------------------------------------------------------ */

/** Marks a link the pane handles itself rather than one the document has. */
const IMPORT_SCHEME = "agentpov-import:";

/** Mirrors `looksLikePath` / `trimTrailingPunctuation` in core's memory.ts. */
function importToken(raw: string): string | null {
  const token = raw.replace(/[,;:)\]}]+$/, "");
  if (token.length === 0 || token.includes("@")) return null;
  return token;
}

/** Joins and normalizes `./` and `../` segments; both inputs are POSIX. */
function joinPath(dir: string, relative: string): string {
  const segments = dir.split("/").filter((part) => part.length > 0);
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return `/${segments.join("/")}`;
}

/** Mirrors `resolveImport` in core's memory.ts. */
function resolveImport(raw: string, fromDir: string, homeDir: string): string {
  if (raw.startsWith("/")) return joinPath("/", raw);
  if (raw.startsWith("~/")) return joinPath(homeDir, raw.slice(2));
  return joinPath(fromDir, raw);
}

type MdastNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
};

/**
 * Turns every `@path` token in ordinary text into a link the viewer handles.
 * Working on the mdast means code spans and fenced blocks are skipped for
 * free: their content lives in `inlineCode`/`code` nodes, not `text` ones.
 */
function remarkImports() {
  return (tree: MdastNode) => {
    const walk = (node: MdastNode) => {
      const children = node.children;
      if (!children) return;
      if (node.type === "link" || node.type === "linkReference") return;

      const next: MdastNode[] = [];
      for (const child of children) {
        if (child.type !== "text" || typeof child.value !== "string") {
          walk(child);
          next.push(child);
          continue;
        }

        const text = child.value;
        const pattern = /(^|\s)@(\S+)/g;
        let cursor = 0;
        let match: RegExpExecArray | null;
        let hit = false;

        while ((match = pattern.exec(text)) !== null) {
          const token = importToken(match[2] ?? "");
          if (token === null) continue;
          hit = true;
          const start = match.index + (match[1] ?? "").length;
          if (start > cursor) {
            next.push({ type: "text", value: text.slice(cursor, start) });
          }
          next.push({
            type: "link",
            url: `${IMPORT_SCHEME}${token}`,
            children: [{ type: "text", value: `@${token}` }],
          });
          cursor = start + 1 + token.length;
        }

        if (!hit) {
          next.push(child);
          continue;
        }
        if (cursor < text.length) {
          next.push({ type: "text", value: text.slice(cursor) });
        }
      }
      node.children = next;
    };
    walk(tree);
  };
}

/* ------------------------------------------------------------------ *
 * Viewer
 * ------------------------------------------------------------------ */

const LINK = "text-om-text cursor-pointer underline decoration-om-border";

/** True while rendering the `code` inside a fenced block's `pre`. */
const FencedContext = createContext(false);

function Code({ children }: { children?: ReactNode }) {
  const fenced = useContext(FencedContext);
  if (fenced) {
    return (
      <code className="text-om-text font-mono text-[12px] whitespace-pre">
        {children}
      </code>
    );
  }
  return (
    <code className="bg-om-raised text-om-text rounded px-1 font-mono text-[12px]">
      {children}
    </code>
  );
}

export function MarkdownViewer({
  path,
  content,
  homeDir,
  onOpenPath,
}: ViewerProps) {
  const { fields, body } = splitFrontmatter(content);
  const fromDir = dirname(path);

  return (
    <div className="pb-3">
      {fields.length > 0 ? <FrontmatterTable fields={fields} /> : null}
      <div className="text-om-text px-3 py-2 text-[13px] leading-[1.55]">
        <Markdown
          remarkPlugins={[remarkGfm, remarkImports]}
          // The default transform drops unknown schemes, which would strip the
          // marker `remarkImports` puts on `@import` links.
          urlTransform={(url) =>
            url.startsWith(IMPORT_SCHEME) ? url : defaultUrlTransform(url)
          }
          components={{
            h1: ({ children }) => (
              <h1 className="text-om-text mt-3 mb-1.5 text-[15px] font-semibold first:mt-0">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-om-text mt-3 mb-1.5 text-[14px] font-semibold first:mt-0">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-om-text mt-2.5 mb-1 text-[13px] font-semibold first:mt-0">
                {children}
              </h3>
            ),
            h4: ({ children }) => (
              <h4 className="text-om-muted mt-2.5 mb-1 text-[13px] font-semibold first:mt-0">
                {children}
              </h4>
            ),
            p: ({ children }) => <p className="my-1.5">{children}</p>,
            ul: ({ children }) => (
              <ul className="my-1.5 list-disc space-y-0.5 pl-4">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="my-1.5 list-decimal space-y-0.5 pl-4">
                {children}
              </ol>
            ),
            li: ({ children }) => <li className="pl-0.5">{children}</li>,
            blockquote: ({ children }) => (
              <blockquote className="border-om-border text-om-muted my-1.5 border-l-2 pl-2.5">
                {children}
              </blockquote>
            ),
            hr: () => <hr className="border-om-border my-3" />,
            code: Code,
            pre: ({ children }) => (
              <FencedContext.Provider value={true}>
                <pre className="border-om-border bg-om-raised my-2 overflow-x-auto rounded-md border px-2.5 py-2">
                  {children}
                </pre>
              </FencedContext.Provider>
            ),
            table: ({ children }) => (
              <div className="my-2 overflow-x-auto">
                <table className="border-om-border w-max border-collapse border text-[12px]">
                  {children}
                </table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border-om-border bg-om-raised text-om-muted border px-2 py-1 text-left font-medium">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border-om-border border px-2 py-1 align-top">
                {children}
              </td>
            ),
            a: ({ href, children }) => {
              if (href?.startsWith(IMPORT_SCHEME)) {
                const raw = href.slice(IMPORT_SCHEME.length);
                const target = resolveImport(raw, fromDir, homeDir);
                return (
                  <a
                    href={href}
                    title={target}
                    onClick={(event) => {
                      event.preventDefault();
                      onOpenPath(target);
                    }}
                    className="text-om-text bg-om-raised border-om-border cursor-pointer rounded border px-1 font-mono text-[12px] hover:underline"
                  >
                    {children}
                  </a>
                );
              }
              return (
                <a
                  href={href}
                  title={href}
                  onClick={(event) => event.preventDefault()}
                  className={LINK}
                >
                  {children}
                </a>
              );
            },
          }}
        >
          {body}
        </Markdown>
      </div>
    </div>
  );
}
