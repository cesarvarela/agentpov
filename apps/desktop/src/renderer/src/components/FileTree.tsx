import { ScrollArea } from "@agentview/ui";

import type { FileNode } from "../../../shared/ipc";
import { basename, countNodes } from "../lib/paths";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Dot,
  FileIcon,
  FolderIcon,
} from "./Icons";

const AMBER = "#e8b04c";
const TEAL = "#4fc7c0";

interface RowProps {
  node: FileNode;
  depth: number;
  selected: string | null;
  expanded: Set<string>;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
}

function Row({
  node,
  depth,
  selected,
  expanded,
  onSelectFile,
  onToggleDir,
}: RowProps) {
  const isDir = node.kind === "dir";
  const isOpen = isDir && expanded.has(node.path);
  const isSelected = !isDir && node.path === selected;
  const hasInstructions = node.marks.includes("instructions");
  const hasMcp = node.marks.includes("mcp");
  const isDenied = node.marks.includes("deny");
  const childCount = node.children?.length ?? 0;

  const padding = 12 + depth * 14 + (isDir ? 0 : 20);

  const nameColor = isSelected
    ? "text-om-amber font-medium"
    : isDenied
      ? "text-om-deny"
      : isDir || hasInstructions || hasMcp
        ? "text-om-text"
        : "text-om-muted";

  return (
    <>
      <button
        type="button"
        onClick={() => (isDir ? onToggleDir(node.path) : onSelectFile(node.path))}
        title={node.path}
        className={`flex h-6 w-full items-center gap-1.5 pr-3 text-left ${
          isSelected ? "bg-[#2a2418]" : "hover:bg-om-raised/60"
        }`}
        style={{ paddingLeft: padding }}
      >
        {isDir ? (
          isOpen ? (
            <ChevronDownIcon className="text-om-muted shrink-0" />
          ) : (
            <ChevronRightIcon className="text-om-muted shrink-0" />
          )
        ) : null}
        {isDir ? (
          <FolderIcon className="text-om-muted shrink-0" />
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
          <span className="text-om-deny rounded-[4px] border border-[#4a2c2c] bg-[#2a1a1a] px-1.5 text-[10px] leading-4">
            deny
          </span>
        ) : null}
        {hasInstructions ? <Dot color={AMBER} /> : null}
        {hasMcp ? <Dot color={TEAL} /> : null}
        {isDir && !isOpen && childCount > 0 ? (
          <span className="text-om-muted text-[11px]">{childCount}</span>
        ) : null}
      </button>

      {isDir && isOpen
        ? (node.children ?? []).map((child) => (
            <Row
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              expanded={expanded}
              onSelectFile={onSelectFile}
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
  selected: string | null;
  expanded: Set<string>;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
}

export function FileTree({
  folder,
  tree,
  selected,
  expanded,
  onSelectFile,
  onToggleDir,
}: FileTreeProps) {
  const nodes = tree ? countNodes(tree) - 1 : 0;

  return (
    <aside className="bg-om-panel flex h-full w-full flex-col overflow-hidden">
      <div className="border-om-border flex h-[34px] shrink-0 items-center justify-between border-b px-3">
        <span className="text-om-muted truncate text-[11px] font-semibold tracking-[0.06em] uppercase">
          {basename(folder)}
        </span>
        <span className="text-om-muted shrink-0 text-[11px]">
          {nodes} node{nodes === 1 ? "" : "s"}
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
                onSelectFile={onSelectFile}
                onToggleDir={onToggleDir}
              />
            ))
          : null}
      </ScrollArea>

      <div className="border-om-border flex shrink-0 flex-col gap-1.5 border-t px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Dot color={AMBER} />
          <span className="text-om-muted text-[11px]">
            carries instructions or rules
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Dot color={TEAL} />
          <span className="text-om-muted text-[11px]">declares MCP servers</span>
        </div>
      </div>
    </aside>
  );
}
