import { useEffect, useRef, useState } from "react";
import { Badge } from "@agentview/ui";

import type { SourceTarget } from "../hooks/useSource";
import { layerLabel } from "../lib/derive";
import { basename, displayPath, formatBytes } from "../lib/paths";
import { VIEWERS, viewerKindFor } from "../viewers";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DocIcon,
  ExternalLinkIcon,
} from "./Icons";
import { SourceLines } from "./SourceLines";

interface Loaded {
  path: string;
  content: string;
  lines: string[];
  bytes: number;
  truncated: boolean;
}

/** Which body the pane shows: the rendered viewer or the raw numbered lines. */
type ViewMode = "rendered" | "source";

/**
 * The last mode the user picked by hand, for this session. Deliberately not
 * per file: switching files keeps whichever view the user asked for. Module
 * scope rather than state because nothing needs to re-render when it changes.
 */
let lastPickedMode: ViewMode | null = null;

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
  /** True when the folder is on an SSH host, where there is no local editor to open. */
  remote: boolean;
  /** Opens another file in the pane: an `@import`, a hook script, a parent. */
  onOpenPath: (path: string, line?: number) => void;
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

function ModeToggle({
  mode,
  onPick,
}: {
  mode: ViewMode;
  onPick: (mode: ViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="border-om-border flex h-[22px] shrink-0 items-center overflow-hidden rounded-md border"
    >
      {(["rendered", "source"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onPick(value)}
          aria-pressed={mode === value}
          className={`h-full cursor-pointer px-2 text-[11px] capitalize transition-colors ${
            mode === value
              ? "bg-om-raised text-om-text"
              : "text-om-muted hover:text-om-text"
          }`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

/** Read-only view of one config file, opened by clicking a row in a card. */
export function SourcePane({
  source,
  folder,
  homeDir,
  remote,
  onOpenPath,
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
  const renderedRef = useRef<HTMLDivElement | null>(null);

  const { path } = source;
  const kind = viewerKindFor(path);
  const Viewer = kind === "text" ? null : VIEWERS[kind];

  // A new target resets the hand-picked mode, so the rules below apply again.
  const targetId = `${path}\n${source.line ?? ""}\n${source.key}`;
  const [pickedFor, setPickedFor] = useState<{
    target: string;
    mode: ViewMode | null;
  }>({ target: targetId, mode: null });
  if (pickedFor.target !== targetId) {
    setPickedFor({ target: targetId, mode: null });
  }

  const mode: ViewMode = !Viewer
    ? "source"
    : (pickedFor.mode ??
      // An opener that named a line wants that line, so start on the lines.
      (source.line !== undefined ? "source" : (lastPickedMode ?? "rendered")));

  const pickMode = (next: ViewMode) => {
    lastPickedMode = next;
    setPickedFor({ target: targetId, mode: next });
  };

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
          content: file.content,
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
    renderedRef.current?.scrollTo({ top: 0 });
  }, [path, mode, fresh]);

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
        {Viewer ? <ModeToggle mode={mode} onPick={pickMode} /> : null}
        {remote ? null : (
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
        )}
      </header>

      {source.importedAt ? (
        <div className="border-om-border/60 text-om-muted flex h-7 shrink-0 items-center border-b px-3 text-[11px]">
          <button
            type="button"
            onClick={() =>
              onOpenPath(
                source.importedAt?.parent ?? "",
                source.importedAt?.line ?? 1,
              )
            }
            className="text-om-text cursor-pointer truncate hover:underline"
          >
            imported at line {source.importedAt.line} of{" "}
            {basename(source.importedAt.parent)}
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <p className="text-om-muted px-3 py-3 text-xs">
            {isMissing(error) ? "File not found on disk." : error}
          </p>
        </div>
      ) : !fresh ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <p className="text-om-muted px-3 py-3 text-xs">
            {loading ? "Loading…" : ""}
          </p>
        </div>
      ) : fresh.lines.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <p className="text-om-muted px-3 py-3 text-xs">Empty file.</p>
        </div>
      ) : mode === "rendered" && Viewer ? (
        <div ref={renderedRef} className="min-h-0 flex-1 overflow-auto">
          <Viewer
            path={path}
            content={fresh.content}
            folder={folder}
            homeDir={homeDir}
            matches={source.matches}
            line={source.line}
            onOpenPath={onOpenPath}
          />
        </div>
      ) : (
        <SourceLines lines={fresh.lines} line={line} path={path} />
      )}

      {fresh?.truncated ? (
        <p className="border-om-border text-om-amber shrink-0 border-t px-3 py-1.5 text-[11px]">
          Truncated at 200 KB — open in an editor to see the rest.
        </p>
      ) : null}
    </aside>
  );
}
