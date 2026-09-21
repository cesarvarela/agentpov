import type { ReactNode } from "react";
import { Badge, ScrollArea } from "@agentview/ui";
import type {
  MemoryEntry,
  PermissionDecision,
  PermissionRule,
  ResolvedContext,
} from "@agentview/core";

import {
  editHooks,
  instructionEntries,
  layerLabel,
  matchingDenyRules,
  memoryEntries,
  verdictFor,
} from "../lib/derive";
import {
  basename,
  dirname,
  displayPath,
  formatBytes,
  languageOf,
  projectPath,
  relativeTo,
} from "../lib/paths";
import type { FileDetail } from "../hooks/useProject";
import {
  CheckIcon,
  DocIcon,
  HookIcon,
  ImportIcon,
  MemoryIcon,
  ShieldIcon,
  WarningIcon,
} from "./Icons";

const DECISION_VARIANT = {
  allow: "allow",
  ask: "ask",
  deny: "deny",
} as const;

function Panel({
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

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="text-om-muted flex h-[30px] items-center px-3 text-[11px]">
      {text}
    </div>
  );
}

function Chip({
  tone,
  icon,
  children,
}: {
  tone: "neutral" | "teal" | "allow" | "ask" | "deny";
  icon?: ReactNode;
  children: ReactNode;
}) {
  const styles = {
    neutral: "border-om-border bg-om-raised text-om-text",
    teal: "border-[#2a4a48] bg-[#15292a] text-om-teal",
    allow: "border-[#2c4a35] bg-[#1a2a20] text-om-allow",
    ask: "border-[#4a3d22] bg-[#2a2418] text-om-amber",
    deny: "border-[#4a2c2c] bg-[#2a1a1a] text-om-deny",
  } as const;

  return (
    <div
      className={`flex h-[26px] shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs ${styles[tone]}`}
    >
      {icon}
      {children}
    </div>
  );
}

const DECISION_TONE = {
  allow: "allow",
  ask: "ask",
  deny: "deny",
} as const;

/** `ALLOW  Edit(src/api/payments.ts)` — small caps decision plus the mono call. */
function VerdictChip({
  decision,
  call,
}: {
  decision: PermissionDecision;
  call: string;
}) {
  return (
    <Chip tone={DECISION_TONE[decision]}>
      <span className="text-[10px] tracking-[0.04em] uppercase">
        {decision}
      </span>
      <span className="font-mono" title={call}>
        {call}
      </span>
    </Chip>
  );
}

function InstructionRow({
  entry,
  folder,
  homeDir,
}: {
  entry: MemoryEntry;
  folder: string;
  homeDir: string;
}) {
  const isDirectory = entry.layer === "directory";
  const size = formatBytes(entry.bytes);

  if (entry.kind === "import") {
    return (
      <div className="border-om-border/60 flex h-7 items-center gap-2.5 border-t bg-[#141721] pr-3 pl-[34px]">
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
      </div>
    );
  }

  return (
    <div
      className={`border-om-border/60 flex h-[30px] items-center gap-2.5 border-t px-3 first:border-t-0 ${
        isDirectory ? "bg-[#1c1d1a]" : ""
      }`}
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
    </div>
  );
}

function ruleNote(rule: PermissionRule): { text: string; className: string } {
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
      text: "matches this file",
      className:
        rule.decision === "deny" ? "text-om-deny" : "text-om-allow",
    };
  }
  return { text: `${layerLabel(rule.layer)} rule`, className: "text-om-muted" };
}

interface ContextViewProps {
  context: ResolvedContext | null;
  detail: FileDetail | null;
  folder: string;
  file: string | null;
  homeDir: string;
  loading: boolean;
}

export function ContextView({
  context,
  detail,
  folder,
  file,
  homeDir,
  loading,
}: ContextViewProps) {
  if (!file) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <p className="text-om-text text-sm">Pick a file in the tree.</p>
        <p className="text-om-muted max-w-sm text-xs">
          agentview will show the instructions, memory, permission rules and
          hooks that apply to it.
        </p>
      </div>
    );
  }

  const rel = relativeTo(file, folder) ?? file;
  const dirLabel = `${displayPath(dirname(file), null, homeDir)}/`;
  const name = basename(file);

  const instructions = context ? instructionEntries(context) : [];
  const instructionFiles = instructions.filter(
    (entry) => entry.kind === "claude-md",
  ).length;
  const memory = context ? memoryEntries(context) : [];
  const hooks = context ? editHooks(context) : [];
  const verdicts = context
    ? ([
        { decision: verdictFor(context, "Edit"), call: `Edit(${rel})` },
        { decision: verdictFor(context, "Read"), call: `Read(${rel})` },
      ] as const)
    : [];
  // Deny rules that hit this file (or something it imports) and were not
  // overridden, minus any already shown as a resolved verdict above.
  const denyRules = context
    ? matchingDenyRules(context).filter(
        (rule) => !verdicts.some((verdict) => verdict.call === rule.rule),
      )
    : [];

  return (
    <ScrollArea className="flex flex-1 flex-col gap-3.5 px-5 py-4">
      <div className="flex shrink-0 flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-om-muted font-mono text-xs">{dirLabel}</span>
          <span className="font-mono text-[17px] font-medium" title={rel}>
            {name}
          </span>
          <span className="text-om-muted text-[11px]">
            {languageOf(name)}
            {detail ? ` · ${detail.lines} lines` : ""}
            {detail?.truncated ? " (truncated)" : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="neutral" icon={<DocIcon className="text-om-muted" />}>
            {instructionFiles} instruction file
            {instructionFiles === 1 ? "" : "s"} in context
          </Chip>
          <Chip tone="teal" icon={<CheckIcon />}>
            {hooks.length} hook{hooks.length === 1 ? "" : "s"} fire on Edit
          </Chip>
          {verdicts.map((verdict) => (
            <VerdictChip
              key={verdict.call}
              decision={verdict.decision}
              call={verdict.call}
            />
          ))}
          {denyRules.map((rule, index) => (
            <VerdictChip
              key={`${rule.path}:${rule.rule}:${index}`}
              decision="deny"
              call={rule.rule}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3.5">
        <Panel
          icon={<DocIcon className="text-om-muted" />}
          title="Instructions in context"
          note={
            instructions.length > 0
              ? `${instructionFiles} files · ordered by precedence, lowest first`
              : undefined
          }
        >
          {instructions.length === 0 ? (
            <EmptyRow
              text={
                loading ? "Resolving…" : "No CLAUDE.md applies to this file."
              }
            />
          ) : (
            instructions.map((entry) => (
              <InstructionRow
                key={`${entry.kind}:${entry.path}:${entry.importedAtLine ?? 0}`}
                entry={entry}
                folder={folder}
                homeDir={homeDir}
              />
            ))
          )}
        </Panel>

        <Panel
          icon={<MemoryIcon className="text-om-muted" />}
          title="Memory"
          note={
            memory[0] ? (
              <span className="font-mono">
                {displayPath(dirname(memory[0].path), null, homeDir)}/
              </span>
            ) : undefined
          }
        >
          {memory.length === 0 ? (
            <EmptyRow text="No memory files for this project." />
          ) : (
            memory.map((entry) => (
              <div
                key={entry.path}
                className="border-om-border/60 flex h-8 items-center gap-2.5 border-t px-3 first:border-t-0"
              >
                <Badge className="w-[66px] shrink-0 justify-center">
                  {layerLabel(entry.layer)}
                </Badge>
                <span className="w-[150px] shrink-0 truncate font-mono text-xs">
                  {basename(entry.path)}
                </span>
                <span className="text-om-muted min-w-0 flex-1 truncate text-[11px]">
                  {entry.content?.split("\n").find((line) => line.trim() !== "")
                    ?.trim() ?? entry.reason}
                </span>
              </div>
            ))
          )}
        </Panel>

        <Panel
          icon={<ShieldIcon className="text-om-muted" />}
          title="Permissions affecting this file"
          note={
            context && context.permissions.length > 0
              ? `${context.permissions.length} rules · Managed > Local > Project > User`
              : undefined
          }
        >
          {!context || context.permissions.length === 0 ? (
            <EmptyRow text="No permission rules found." />
          ) : (
            context.permissions.map((rule, index) => {
              const note = ruleNote(rule);
              return (
                <div
                  key={`${rule.path}:${rule.rule}:${index}`}
                  className="border-om-border/60 flex h-[30px] items-center gap-2.5 border-t px-3 first:border-t-0"
                >
                  <Badge
                    variant={DECISION_VARIANT[rule.decision]}
                    className="w-[46px] shrink-0 justify-center"
                  >
                    {rule.decision}
                  </Badge>
                  <span
                    className={`w-[200px] shrink-0 truncate font-mono text-xs ${
                      rule.overridden
                        ? "text-om-muted line-through"
                        : "text-om-text"
                    }`}
                  >
                    {rule.rule}
                  </span>
                  <Badge className="w-[66px] shrink-0 justify-center">
                    {layerLabel(rule.layer)}
                  </Badge>
                  <span
                    className="text-om-muted min-w-0 flex-1 truncate font-mono text-[11px]"
                    title={rule.path}
                  >
                    {projectPath(rule.path, folder, homeDir)}
                  </span>
                  <span className={`shrink-0 text-[11px] ${note.className}`}>
                    {note.text}
                  </span>
                </div>
              );
            })
          )}
        </Panel>

        <Panel
          icon={<HookIcon className="text-om-teal" />}
          title="Hooks that fire here"
          note="on Edit of this path"
        >
          {hooks.length === 0 ? (
            <EmptyRow text="No hooks fire on an Edit of this file." />
          ) : (
            hooks.map((hook, index) => (
              <div
                key={`${hook.path}:${hook.event}:${index}`}
                className="border-om-border/60 flex h-8 items-center gap-2.5 border-t px-3 first:border-t-0"
              >
                <span className="text-om-teal w-[92px] shrink-0 text-[11px] font-medium">
                  {hook.event}
                </span>
                <span className="text-om-muted w-[86px] shrink-0 truncate font-mono text-[11px]">
                  {hook.matcher ?? "*"}
                </span>
                <span
                  className="min-w-0 flex-1 truncate font-mono text-xs"
                  title={hook.command}
                >
                  {hook.command}
                </span>
                <Badge className="w-[66px] shrink-0 justify-center">
                  {layerLabel(hook.layer)}
                </Badge>
                <span className="text-om-muted shrink-0 text-[11px]">
                  {hook.timeoutSeconds
                    ? `timeout ${hook.timeoutSeconds}s`
                    : "no timeout"}
                </span>
              </div>
            ))
          )}
        </Panel>

        {context && context.diagnostics.length > 0 ? (
          <div className="flex shrink-0 flex-col gap-1 pb-2">
            {context.diagnostics.map((diagnostic) => (
              <div
                key={diagnostic}
                className="text-om-amber flex items-start gap-1.5 text-[11px]"
              >
                <WarningIcon className="mt-px size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{diagnostic}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
