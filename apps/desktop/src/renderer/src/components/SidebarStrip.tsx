import { SidebarIcon } from "./Icons";

interface SidebarStripProps {
  /** Folder name shown rotated along the strip. */
  label: string;
  onExpand: () => void;
}

/** The 40px rail that replaces the file tree while the sidebar is collapsed. */
export function SidebarStrip({ label, onExpand }: SidebarStripProps) {
  return (
    <div className="border-om-border bg-om-panel flex w-10 shrink-0 flex-col items-center gap-3.5 overflow-hidden border-r py-2">
      <button
        type="button"
        onClick={onExpand}
        title="Show sidebar"
        aria-label="Show sidebar"
        className="border-om-border bg-om-raised text-om-muted hover:text-om-text flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors"
      >
        <SidebarIcon className="size-4" />
      </button>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-hidden">
        <span
          className="text-om-muted text-[10px] font-semibold tracking-[0.14em] uppercase"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
