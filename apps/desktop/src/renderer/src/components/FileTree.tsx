import { Badge, ScrollArea } from "@agentpov/ui";

import type { FileNode, TargetKind } from "../../../shared/ipc";
import { basename, countNodes } from "../lib/paths";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Dot,
  FileIcon,
  FolderIcon,
} from "./Icons";

// Colour semantics, all driven by the `--om-*` tokens in @agentpov/ui: amber
// is the app's own accent (selection, focus), orange is the Claude Code agent's
// identity, and anything without a meaning of its own stays muted — MCP
// included. A second agent gets its own token rather than reusing amber.

interface RowProps {
  node: FileNode;
  depth: number;
  /** Absolute path of the selected row, file or folder. */
  selected: string | null;
  expanded: Set<string>;
  onSelect: (path: string, kind: TargetKind) => void;
  onToggleDir: (path: string) => void;
}

/** Placeholder rows while the tree is being listed (slow over SSH). */
function TreeSkeleton() {
  const widths = [62, 48, 70, 40, 55, 66, 44];
  return (
    <div aria-label="Loading files" className="flex flex-col gap-2.5 px-3 py-1.5">
      {widths.map((width, index) => (
        <div
          key={index}
          className="bg-om-raised h-2.5 animate-pulse rounded-sm"
          style={{ width: `${width}%`, marginLeft: index % 3 === 2 ? 14 : 0 }}
        />
      ))}
    </div>
  );
}

/**
 * One tree row. Folders are selectable like files: the chevron expands and
 * collapses, the rest of the row makes the folder the context target.
 */
function Row({
  node,
  depth,
  selected,
  expanded,
  onSelect,
  onToggleDir,
}: RowProps) {
  const isDir = node.kind === "dir";
  const isOpen = isDir && expanded.has(node.path);
  const isSelected = node.path === selected;
  const hasInstructions = node.marks.includes("instructions");
  const hasMcp = node.marks.includes("mcp");
  const isDenied = node.marks.includes("deny");
  const childCount = node.children?.length ?? 0;

  // Files get the chevron's width back so their icon lines up with a folder's.
  const padding = 12 + depth * 14 + (isDir ? 0 : 16);

  const nameColor = isSelected
    ? "text-om-amber font-medium"
    : isDenied
      ? "text-om-deny"
      : isDir || hasInstructions || hasMcp
        ? "text-om-text"
        : "text-om-muted";

  return (
    <>
      <div
        className={`flex h-6 w-full items-center ${
          isSelected ? "bg-om-amber-bg" : "hover:bg-om-raised/60"
        }`}
        style={{ paddingLeft: padding }}
      >
        {isDir ? (
          <button
            type="button"
            onClick={() => onToggleDir(node.path)}
            title={isOpen ? "Collapse" : "Expand"}
            aria-label={isOpen ? "Collapse" : "Expand"}
            className="flex size-4 shrink-0 cursor-pointer items-center justify-center"
          >
            {isOpen ? (
              <ChevronDownIcon className="text-om-muted shrink-0" />
            ) : (
              <ChevronRightIcon className="text-om-muted shrink-0" />
            )}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onSelect(node.path, isDir ? "directory" : "file")}
          title={node.path}
          className="flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-1.5 pr-3 pl-1.5 text-left"
        >
          {isDir ? (
            <FolderIcon
              className={`shrink-0 ${
                isSelected ? "text-om-amber" : "text-om-muted"
              }`}
            />
          ) : (
            <FileIcon
              className={`shrink-0 ${
                isSelected
                  ? "text-om-amber"
                  : isDenied
                    ? "text-om-deny"
                    : "text-om-muted"
              }`}
            />
          )}
          <span
            className={`min-w-0 flex-1 truncate font-mono text-xs ${nameColor}`}
          >
            {node.name}
            {isDir ? "/" : ""}
          </span>
          {isDenied ? (
            <Badge variant="deny">deny</Badge>
          ) : null}
          {hasInstructions ? <Dot className="bg-om-orange" /> : null}
          {hasMcp ? <Dot className="bg-om-muted" /> : null}
          {isDir && !isOpen && childCount > 0 ? (
            <span className="text-om-muted text-[11px]">{childCount}</span>
          ) : null}
        </button>
      </div>

      {isDir && isOpen
        ? (node.children ?? []).map((child) => (
            <Row
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              expanded={expanded}
              onSelect={onSelect}
              onToggleDir={onToggleDir}
            />
          ))
        : null}
    </>
  );
}

interface FileTreeProps {
  folder: string;
  tree: FileNode | null;
  /** Absolute path of the selected row, file or folder. */
  selected: string | null;
  expanded: Set<string>;
  onSelect: (path: string, kind: TargetKind) => void;
  onToggleDir: (path: string) => void;
}

export function FileTree({
  folder,
  tree,
  selected,
  expanded,
  onSelect,
  onToggleDir,
}: FileTreeProps) {
  const nodes = tree ? countNodes(tree) - 1 : 0;

  return (
    <aside className="bg-om-panel flex h-full w-full flex-col overflow-hidden">
      <div className="border-om-border flex h-[34px] shrink-0 items-center justify-between border-b px-3">
        <button
          type="button"
          onClick={() => onSelect(folder, "directory")}
          title={folder}
          className={`min-w-0 cursor-pointer truncate text-left text-[11px] font-semibold tracking-[0.06em] uppercase ${
            selected === folder ? "text-om-amber" : "text-om-muted"
          }`}
        >
          {basename(folder)}
        </button>
        <span className="text-om-muted shrink-0 text-[11px]">
          {tree ? `${nodes} node${nodes === 1 ? "" : "s"}` : "Loading…"}
        </span>
      </div>

      <ScrollArea className="flex-1 py-1.5">
        {tree
          ? (tree.children ?? []).map((child) => (
              <Row
                key={child.path}
                node={child}
                depth={0}
                selected={selected}
                expanded={expanded}
                onSelect={onSelect}
                onToggleDir={onToggleDir}
              />
            ))
          : <TreeSkeleton />}
      </ScrollArea>

      <div className="border-om-border flex shrink-0 flex-col gap-1.5 border-t px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Dot className="bg-om-orange" />
          <span className="text-om-muted text-[11px]">
            carries instructions or rules
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Dot className="bg-om-muted" />
          <span className="text-om-muted text-[11px]">declares MCP servers</span>
        </div>
      </div>
    </aside>
  );
}
