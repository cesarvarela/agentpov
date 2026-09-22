import { useState } from "react";

import { ChevronRightIcon } from "../components/Icons";
import { ParseFailure, isRecord, parseJson } from "./shared";
import type { ViewerProps } from "./types";

/**
 * Generic collapsible JSON tree. It is both the fallback viewer for any
 * `.json` file and the escape hatch the settings and MCP viewers use for keys
 * they have no opinion about.
 */

/** Below this depth branches start collapsed. */
const DEFAULT_OPEN_DEPTH = 2;

function isBranch(value: unknown): boolean {
  return Array.isArray(value) || isRecord(value);
}

function Leaf({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return <span className="text-om-text break-words">{value}</span>;
  }
  return (
    <span className="text-om-text break-words">
      {value === null ? "null" : String(value)}
    </span>
  );
}

function childEntries(value: unknown): [string, unknown][] {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), item]);
  }
  if (isRecord(value)) return Object.entries(value);
  return [];
}

/** `[3]` / `{2}` — what a collapsed branch says about what is inside. */
function summary(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`;
  return `{${Object.keys(value as Record<string, unknown>).length}}`;
}

function Node({
  name,
  value,
  depth,
}: {
  name: string;
  value: unknown;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < DEFAULT_OPEN_DEPTH);

  if (!isBranch(value)) {
    return (
      <div className="flex items-baseline gap-1.5 font-mono text-[11px] leading-[18px]">
        <span className="text-om-muted shrink-0">{name}</span>
        <span className="min-w-0 flex-1">
          <Leaf value={value} />
        </span>
      </div>
    );
  }

  const entries = childEntries(value);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        className="flex cursor-pointer items-center gap-1 text-left font-mono text-[11px] leading-[18px]"
      >
        <ChevronRightIcon
          className={`text-om-muted size-3 shrink-0 transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
        <span className="text-om-muted truncate">{name}</span>
        {open ? null : (
          <span className="text-om-muted shrink-0">{summary(value)}</span>
        )}
      </button>
      {open ? (
        <div className="flex flex-col pl-3">
          {entries.length === 0 ? (
            <span className="text-om-muted font-mono text-[11px] leading-[18px]">
              {Array.isArray(value) ? "[]" : "{}"}
            </span>
          ) : (
            entries.map(([key, child]) => (
              <Node key={key} name={key} value={child} depth={depth + 1} />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A parsed JSON value as a tree. Exported on its own so the settings and MCP
 * viewers can embed the keys they do not render themselves; `depth` is where
 * the subtree sits, which decides what starts expanded.
 */
export function JsonTree({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  if (!isBranch(value)) {
    return (
      <div className="font-mono text-[11px] leading-[18px]">
        <Leaf value={value} />
      </div>
    );
  }

  const entries = childEntries(value);
  if (entries.length === 0) {
    return (
      <div className="text-om-muted font-mono text-[11px] leading-[18px]">
        {Array.isArray(value) ? "[]" : "{}"}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {entries.map(([key, child]) => (
        <Node key={key} name={key} value={child} depth={depth} />
      ))}
    </div>
  );
}

export function JsonViewer({ content }: ViewerProps) {
  const parsed = parseJson(content);
  if (!parsed.ok) return <ParseFailure error={parsed.error} content={content} />;

  return (
    <div className="px-3 py-2">
      <JsonTree value={parsed.value} />
    </div>
  );
}
