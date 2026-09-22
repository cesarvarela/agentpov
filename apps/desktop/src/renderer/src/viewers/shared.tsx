import type { ReactNode } from "react";

/**
 * Pieces every rendered config viewer shares: the section chrome, the
 * key/value row, secret masking and the "this is the row you clicked"
 * highlight. Kept here so `SettingsViewer`, `McpViewer` and `JsonViewer`
 * agree on type sizes and colours in a pane that is only ~380px wide.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `JSON.parse` that never throws; the message is shown to the user verbatim. */
export function parseJson(
  content: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(content) as unknown };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * A file the viewer cannot make sense of: say so in one muted line, then get
 * out of the way and show the bytes as they are on disk.
 */
export function ParseFailure({
  error,
  content,
}: {
  error: string;
  content: string;
}) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <p className="text-om-muted text-[11px]">Not valid JSON — {error}</p>
      <pre className="text-om-text font-mono text-xs whitespace-pre-wrap">
        {content}
      </pre>
    </div>
  );
}

/** Uppercase divider that splits the viewer into sections. */
export function Section({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5 px-3 py-2">
      <h3 className="text-om-muted text-[11px] tracking-[0.06em] uppercase">
        {label}
      </h3>
      {children}
    </section>
  );
}

/** Smaller heading inside a section: a hook event, a permission decision. */
export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-om-text font-mono text-xs font-semibold">{children}</h4>
  );
}

/** `matcher: *` and friends — a short mono token on the raised surface. */
export function MonoChip({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className={`border-om-border bg-om-bg inline-flex items-center rounded-[4px] border px-1.5 font-mono text-[11px] leading-[18px] ${
        muted ? "text-om-muted" : "text-om-text"
      }`}
    >
      {children}
    </span>
  );
}

/** Two-column row: muted key on the left, mono value on the right. */
export function KeyValue({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="text-om-muted shrink-0 truncate">{label}</span>
      <span className="text-om-text min-w-0 flex-1 font-mono text-[11px] break-words">
        {children}
      </span>
    </div>
  );
}

// `auth`, `cookie` and `credential` are here on top of the obvious four
// because an `Authorization: Bearer …` header is a secret whatever it is
// called, and ContextPanels already refuses to print header values at all.
const SECRET_KEY = /token|secret|key|password|auth|cookie|credential/i;

/** Env vars and MCP headers whose name says they hold a credential. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/**
 * Value of an `env` / `headers` entry. A key that names a credential is never
 * rendered — not in the text, not in a `title`, not in the DOM at all — so the
 * pane cannot leak a token to a screenshot or a copy/paste.
 */
export function MaskedValue({ name, value }: { name: string; value: string }) {
  if (isSecretKey(name)) {
    return (
      <>
        ••••<span className="text-om-muted ml-1.5">(hidden)</span>
      </>
    );
  }
  return <>{value}</>;
}

/** `env` / `headers` as a compact two-column table, secrets masked. */
export function ValueTable({
  label,
  values,
}: {
  label: string;
  values: Record<string, unknown>;
}) {
  const entries = Object.entries(values);
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-om-muted text-[11px]">{label}</span>
      {entries.map(([key, value]) => (
        <KeyValue key={key} label={key}>
          <MaskedValue name={key} value={scalarText(value)} />
        </KeyValue>
      ))}
    </div>
  );
}

/** One-line rendering of a JSON scalar; anything else falls back to JSON. */
export function scalarText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}

/**
 * Did the row that opened this file point at `text`? The openers pass the
 * literal they searched the raw file for (a hook command, a permission rule,
 * sometimes quoted), so a substring test in either direction is what matches.
 */
export function hits(text: string, matches: string[] | undefined): boolean {
  if (!matches || matches.length === 0) return false;
  return needles(matches).some((needle) => text.includes(needle));
}

/**
 * Same question for openers that pass a *whole* name rather than a snippet:
 * an MCP server row passes `"fs"`, and a substring test would also light up
 * `fs-extra`. Compares the unquoted needle to `text` for equality instead.
 */
export function hitsExactly(
  text: string,
  matches: string[] | undefined,
): boolean {
  if (!matches || matches.length === 0) return false;
  return needles(matches).some((needle) => text === needle);
}

/** The literals in `matches`, unquoted, trimmed and without the empty ones. */
function needles(matches: string[]): string[] {
  return matches
    .map((match) => match.replace(/^"(.*)"$/s, "$1").trim())
    .filter((needle) => needle.length > 0);
}

/** Amber tint for the matched card, mirroring the line highlight in SourcePane. */
export const HIGHLIGHT = "bg-om-amber/12 border-om-amber";

/** Bordered card on the panel surface; `highlighted` swaps in the amber tint. */
export function Card({
  highlighted = false,
  innerRef,
  children,
}: {
  highlighted?: boolean;
  innerRef?: (node: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div
      ref={innerRef}
      className={`flex flex-col gap-1 rounded-md border px-2 py-1.5 ${
        highlighted ? HIGHLIGHT : "border-om-border bg-om-bg"
      }`}
    >
      {children}
    </div>
  );
}

const INTERPRETERS = new Set([
  "bash",
  "sh",
  "zsh",
  "node",
  "deno",
  "python",
  "python3",
  "ruby",
  "perl",
]);

const SCRIPT_EXT = /\.(sh|bash|zsh|js|mjs|cjs|ts|mts|cts|py|rb|pl|command)$/i;

/**
 * The script a hook command runs, as an absolute path, or `null` when the
 * command is an inline shell one-liner. Only the leading token is considered
 * (after an optional plain interpreter), so `jq … | .claude/x.sh` is not
 * mistaken for a file the pane could open.
 */
export function hookScriptPath(
  command: string,
  folder: string,
  homeDir: string,
): string | null {
  const tokens = command.trim().split(/\s+/);
  let token = tokens[0];
  if (
    token !== undefined &&
    INTERPRETERS.has(token) &&
    tokens[1] !== undefined
  ) {
    token = tokens[1];
  }
  if (token === undefined) return null;

  const raw = token.replace(/^["']|["']$/g, "");
  if (raw.length === 0) return null;
  // Either it names a script by extension, or it is a bare path with a slash.
  if (!SCRIPT_EXT.test(raw) && !raw.includes("/")) return null;
  // A shell operator or a substitution is not a path.
  if (/[|&;<>()$`*?]/.test(raw.replace(/^\$\{?CLAUDE_PROJECT_DIR\}?/, ""))) {
    return null;
  }

  const projectDir = raw.match(/^\$\{?CLAUDE_PROJECT_DIR\}?\/?(.*)$/s);
  if (projectDir) return join(folder, projectDir[1] ?? "");
  if (raw === "~") return homeDir;
  if (raw.startsWith("~/")) return join(homeDir, raw.slice(2));
  if (raw.startsWith("/")) return raw;
  return join(folder, raw.replace(/^\.\//, ""));
}

function join(base: string, rest: string): string {
  if (rest.length === 0) return base;
  return `${base.replace(/\/$/, "")}/${rest}`;
}

/** `open` affordance next to a hook command that points at a script on disk. */
export function OpenLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-om-muted hover:text-om-text shrink-0 cursor-pointer text-[11px] underline"
    >
      open
    </button>
  );
}
