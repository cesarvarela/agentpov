import type { ReactNode } from "react";
import { Badge } from "@agentview/ui";
import type {
  ConfigLayer,
  MemoryEntry,
  PermissionRule,
  TargetKind,
} from "@agentview/core";

import { layerLabel } from "../lib/derive";
import {
  basename,
  displayPath,
  formatBytes,
  projectPath,
  relativeTo,
} from "../lib/paths";
import { ImportIcon, WarningIcon } from "./Icons";

/** Badge colour per permission decision. */
export const DECISION_VARIANT = {
  allow: "allow",
  ask: "ask",
  deny: "deny",
} as const;

/**
 * Layers listed highest-precedence first. Kept as a local literal: a runtime
 * import from `@agentview/core` would drag its Node file-system module into
 * the browser bundle.
 */
export const SETTINGS_LAYER_ORDER: ConfigLayer[] = [
  "managed",
  "directory",
  "local",
  "project",
  "user",
];

export function layerRank(layer: ConfigLayer): number {
  const index = SETTINGS_LAYER_ORDER.indexOf(layer);
  return index === -1 ? SETTINGS_LAYER_ORDER.length : index;
}

/** Muted label that splits a panel into sections. */
export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="text-om-muted border-om-border/60 flex h-6 items-center border-t px-3 text-[10px] tracking-[0.04em] uppercase">
      {label}
    </div>
  );
}

export function Panel({
  icon,
  title,
  note,
  children,
}: {
  icon: ReactNode;
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-om-border bg-om-panel shrink-0 overflow-hidden rounded-md border">
      <div className="border-om-border flex h-8 items-center gap-2 border-b px-3">
        {icon}
        <span className="shrink-0 text-xs font-semibold">{title}</span>
        {note ? (
          <span className="text-om-muted min-w-0 flex-1 truncate text-right text-[11px]">
            {note}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

export function EmptyRow({ text }: { text: string }) {
  return (
    <div className="text-om-muted flex h-[30px] items-center px-3 text-[11px]">
      {text}
    </div>
  );
}

/** A card row that opens its backing file in the source pane. */
export function RowButton({
  active,
  bg,
  height,
  padding = "px-3",
  title,
  onClick,
  children,
}: {
  active: boolean;
  /** Background class for the resting state, if the row has one. */
  bg?: string;
  height: string;
  padding?: string;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`border-om-border/60 flex w-full shrink-0 cursor-pointer items-center gap-2.5 border-t text-left transition-colors first:border-t-0 ${height} ${padding} ${
        active
          ? "bg-[#2a2418] shadow-[inset_2px_0_0_var(--om-amber)]"
          : `${bg ?? ""} hover:bg-om-raised`
      }`}
    >
      {children}
    </button>
  );
}

/** One CLAUDE.md, `@import` or memory file row. */
export function InstructionRow({
  entry,
  folder,
  homeDir,
  active,
  onOpen,
}: {
  entry: MemoryEntry;
  folder: string;
  homeDir: string;
  active: boolean;
  onOpen: () => void;
}) {
  const isDirectory = entry.layer === "directory";
  const size = formatBytes(entry.bytes);

  if (entry.kind === "import") {
    return (
      <RowButton
        active={active}
        bg="bg-[#141721]"
        height="h-7"
        padding="pr-3 pl-[34px]"
        title={entry.path}
        onClick={onOpen}
      >
        <ImportIcon className="text-om-teal shrink-0" />
        <Badge variant="teal" className="w-[52px] shrink-0 justify-center">
          import
        </Badge>
        <span className="text-om-muted min-w-0 flex-1 truncate font-mono text-xs">
          {displayPath(entry.path, folder, homeDir)}
        </span>
        <span className="text-om-muted shrink-0 text-[11px]">
          {entry.importedAtLine
            ? `inlined at line ${entry.importedAtLine}${
                entry.importedBy ? ` of ${basename(entry.importedBy)}` : ""
              }`
            : "inlined"}
        </span>
      </RowButton>
    );
  }

  return (
    <RowButton
      active={active}
      bg={isDirectory ? "bg-[#1c1d1a]" : undefined}
      height="h-[30px]"
      title={entry.path}
      onClick={onOpen}
    >
      <Badge
        variant={isDirectory ? "amber" : "default"}
        className="w-[66px] shrink-0 justify-center"
      >
        {layerLabel(entry.layer)}
      </Badge>
      <span
        className={`min-w-0 flex-1 truncate font-mono text-xs ${
          isDirectory ? "text-om-amber" : "text-om-text"
        }`}
      >
        {isDirectory
          ? (relativeTo(entry.path, folder) ?? entry.path)
          : projectPath(entry.path, folder, homeDir)}
      </span>
      <span
        className={`shrink-0 text-[11px] ${
          isDirectory ? "text-om-amber" : "text-om-muted"
        }`}
      >
        {entry.reason}
        {size ? ` · ${size}` : ""}
      </span>
    </RowButton>
  );
}

/** Right-hand annotation of a permission row. */
export function ruleNote(
  rule: PermissionRule,
  targetKind: TargetKind,
): { text: string; className: string } {
  if (rule.layer === "managed") {
    return { text: "cannot be overridden", className: "text-om-muted" };
  }
  if (rule.overridden) {
    return {
      text: `overridden by ${rule.overriddenBy ? layerLabel(rule.overriddenBy) : "a higher layer"}`,
      className: "text-om-amber",
    };
  }
  if (rule.matchesFile) {
    return {
      text: targetKind === "directory" ? "matches this folder" : "matches this file",
      className: rule.decision === "deny" ? "text-om-deny" : "text-om-allow",
    };
  }
  return { text: `${layerLabel(rule.layer)} rule`, className: "text-om-muted" };
}

/** `ALLOW  Edit(src/**)  Project  .claude/settings.json  matches this folder`. */
export function PermissionRow({
  rule,
  targetKind,
  folder,
  homeDir,
  active,
  onOpen,
}: {
  rule: PermissionRule;
  targetKind: TargetKind;
  folder: string;
  homeDir: string;
  active: boolean;
  onOpen: () => void;
}) {
  const note = ruleNote(rule, targetKind);

  return (
    <RowButton
      active={active}
      height="h-[30px]"
      title={rule.path}
      onClick={onOpen}
    >
      <Badge
        variant={DECISION_VARIANT[rule.decision]}
        className="w-[46px] shrink-0 justify-center"
      >
        {rule.decision}
      </Badge>
      <span
        className={`min-w-0 flex-1 truncate font-mono text-xs ${
          rule.overridden ? "text-om-muted line-through" : "text-om-text"
        }`}
      >
        {rule.rule}
      </span>
      <Badge className="w-[66px] shrink-0 justify-center">
        {layerLabel(rule.layer)}
      </Badge>
      <span
        className="text-om-muted shrink-0 truncate font-mono text-[11px]"
        title={rule.path}
      >
        {projectPath(rule.path, folder, homeDir)}
      </span>
      <span className={`shrink-0 text-[11px] ${note.className}`}>
        {note.text}
      </span>
    </RowButton>
  );
}

/** Amber warning lines for whatever the resolver could not make sense of. */
export function Diagnostics({ diagnostics }: { diagnostics: string[] }) {
  if (diagnostics.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-col gap-1 pb-2">
      {diagnostics.map((diagnostic) => (
        <div
          key={diagnostic}
          className="text-om-amber flex items-start gap-1.5 text-[11px]"
        >
          <WarningIcon className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{diagnostic}</span>
        </div>
      ))}
    </div>
  );
}

/** Source-pane target for a permission rule: its line in the settings file. */
export function ruleSourceMatches(rule: PermissionRule): string[] {
  return [`"${rule.rule}"`, rule.rule];
}
