import { useEffect, useRef } from "react";

interface SourceLinesProps {
  /** File contents split on newlines. */
  lines: string[];
  /** 1-based line to highlight, or null when nothing matched. */
  line: number | null;
  /** Absolute path, so a new file re-runs the scroll even at the same line. */
  path: string;
}

/**
 * The plain numbered-line body of the source pane. Owns its own scroller so it
 * can bring the highlighted line into view, or start at the top without one.
 */
export function SourceLines({ lines, line, path }: SourceLinesProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (line === null) {
      bodyRef.current?.scrollTo({ top: 0 });
      return;
    }
    highlightRef.current?.scrollIntoView({ block: "center" });
  }, [line, path, lines]);

  return (
    <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto">
      <div className="min-w-max py-1 font-mono text-xs leading-[18px]">
        {lines.map((text, index) => {
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
                    ? "border-om-amber text-om-amber bg-om-amber-bg"
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
    </div>
  );
}
