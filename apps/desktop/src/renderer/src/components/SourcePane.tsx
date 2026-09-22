import { useEffect, useRef, useState } from "react";
import { Badge } from "@agentview/ui";

import type { SourceTarget } from "../hooks/useSource";
import { layerLabel } from "../lib/derive";
import { basename, displayPath, formatBytes } from "../lib/paths";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DocIcon,
  ExternalLinkIcon,
} from "./Icons";

interface Loaded {
  path: string;
  lines: string[];
  bytes: number;
  truncated: boolean;
}

/** 1-based line to highlight, or null when nothing matched. */
function highlightLine(target: SourceTarget, lines: string[]): number | null {
  if (target.line && target.line >= 1) return target.line;
  for (const needle of target.matches ?? []) {
    if (needle === "") continue;
    const index = lines.findIndex((line) => line.includes(needle));
    if (index !== -1) return index + 1;
  }
  return null;
}

function isMissing(message: string): boolean {
  return message.includes("ENOENT") || message.includes("Not a file");
}

interface SourcePaneProps {
  source: SourceTarget;
  folder: string;
  homeDir: string;
  /** Opens the file that contains an `@import` reference, at that line. */
  onOpenParent: (path: string, line: number) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

const NAV_BUTTON =
  "border-om-border bg-om-raised text-om-muted hover:text-om-text flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors disabled:opacity-40 disabled:cursor-default";

/** Shown while the pane is open but no row has been clicked yet. */
export function SourcePaneEmpty() {
  return (
    <aside className="border-om-border bg-om-panel flex h-full min-w-0 flex-col items-center justify-center border-l px-4">
      <p className="text-om-muted text-center text-xs">
        Click a row in a card to view its source.
      </p>
    </aside>
  );
}

/** Read-only view of one config file, opened by clicking a row in a card. */
export function SourcePane({
  source,
  folder,
  homeDir,
  onOpenParent,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: SourcePaneProps) {
  const api = window.agentview;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /** Guards against out-of-order responses when clicking rows quickly. */
  const requestId = useRef(0);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const { path } = source;

  useEffect(() => {
    if (!api) {
      setError("Bridge unavailable.");
      return;
    }

    const id = ++requestId.current;
    setLoading(true);

    void (async () => {
      try {
        const file = await api.readFile(path);
        if (id !== requestId.current) return;
        setLoaded({
          path: file.path,
          lines: file.content === "" ? [] : file.content.split("\n"),
          bytes: file.bytes,
          truncated: file.truncated,
        });
        setError(null);
      } catch (cause) {
        if (id !== requestId.current) return;
        setLoaded(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    })();
  }, [api, path]);

  const fresh = loaded && loaded.path === path ? loaded : null;
  const line = fresh ? highlightLine(source, fresh.lines) : null;

  useEffect(() => {
    if (line === null) {
      bodyRef.current?.scrollTo({ top: 0 });
      return;
    }
    highlightRef.current?.scrollIntoView({ block: "center" });
  }, [line, path, fresh]);

  const label = displayPath(path, folder, homeDir);
  const size = fresh ? formatBytes(fresh.bytes) : null;

  return (
    <aside className="border-om-border bg-om-panel flex h-full min-w-0 flex-col border-l">
      <header className="border-om-border flex h-8 shrink-0 items-center gap-2 border-b px-3">
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onBack}
            disabled={!canGoBack}
            title="Back"
            aria-label="Back"
            className={NAV_BUTTON}
          >
            <ChevronLeftIcon className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onForward}
            disabled={!canGoForward}
            title="Forward"
            aria-label="Forward"
            className={NAV_BUTTON}
          >
            <ChevronRightIcon className="size-3.5" />
          </button>
        </div>
        <DocIcon className="text-om-muted shrink-0" />
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs"
          title={path}
        >
          {label}
        </span>
        {source.layer ? (
          <Badge className="shrink-0">{layerLabel(source.layer)}</Badge>
        ) : null}
        {size ? (
          <span className="text-om-muted shrink-0 text-[11px]">{size}</span>
        ) : null}
        <button
          type="button"
          onClick={() => void api?.openInEditor(path)}
          title="Open in editor"
          aria-label="Open in editor"
          className="border-om-border bg-om-raised text-om-muted hover:text-om-text flex h-[22px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors"
        >
          <ExternalLinkIcon className="size-3.5" />
          Open in editor
        </button>
      </header>

      {source.importedAt ? (
        <div className="border-om-border/60 text-om-muted flex h-7 shrink-0 items-center border-b px-3 text-[11px]">
          <button
            type="button"
            onClick={() =>
              onOpenParent(
                source.importedAt?.parent ?? "",
                source.importedAt?.line ?? 1,
              )
            }
            className="text-om-teal cursor-pointer truncate hover:underline"
          >
            imported at line {source.importedAt.line} of{" "}
            {basename(source.importedAt.parent)}
          </button>
        </div>
      ) : null}

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="text-om-muted px-3 py-3 text-xs">
            {isMissing(error) ? "File not found on disk." : error}
          </p>
        ) : !fresh ? (
          <p className="text-om-muted px-3 py-3 text-xs">
            {loading ? "Loading…" : ""}
          </p>
        ) : fresh.lines.length === 0 ? (
          <p className="text-om-muted px-3 py-3 text-xs">Empty file.</p>
        ) : (
          <div className="min-w-max py-1 font-mono text-xs leading-[18px]">
            {fresh.lines.map((text, index) => {
              const number = index + 1;
              const active = number === line;
              return (
                <div
                  key={number}
                  ref={active ? highlightRef : null}
                  className={`flex ${active ? "bg-om-amber/12" : ""}`}
                >
                  <span
                    className={`sticky left-0 w-[46px] shrink-0 border-l-2 pr-2.5 text-right text-[11px] select-none ${
                      active
                        ? "border-om-amber text-om-amber bg-[#2a2418]"
                        : "bg-om-panel text-om-muted border-transparent"
                    }`}
                  >
                    {number}
                  </span>
                  <span className="text-om-text pr-4 whitespace-pre">
                    {text === "" ? " " : text}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {fresh?.truncated ? (
        <p className="border-om-border text-om-amber shrink-0 border-t px-3 py-1.5 text-[11px]">
          Truncated at 200 KB — open in an editor to see the rest.
        </p>
      ) : null}
    </aside>
  );
}
