import type { ReactNode } from "react";
import { Badge, ScrollArea } from "@agentview/ui";
import type {
  ConfigLayer,
  MemoryEntry,
  PermissionDecision,
  PermissionRule,
  ResolvedContext,
  SettingsEntry,
} from "@agentview/core";

import {
  editHooks,
  instructionEntries,
  layerLabel,
  matchingDenyRules,
  memoryEntries,
  verdictFor,
  winningRuleFor,
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
import type { SourceTarget } from "../hooks/useSource";
import {
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

/**
 * Settings files are listed highest-precedence first. Kept as a local literal:
 * a runtime import from `@agentview/core` would drag its Node file-system
 * module into the browser bundle.
 */
const SETTINGS_LAYER_ORDER: ConfigLayer[] = [
  "managed",
  "directory",
  "local",
  "project",
  "user",
];

function layerRank(layer: ConfigLayer): number {
  const index = SETTINGS_LAYER_ORDER.indexOf(layer);
  return index === -1 ? SETTINGS_LAYER_ORDER.length : index;
}

/** Muted label that splits a panel into sections. */
function SectionDivider({ label }: { label: string }) {
  return (
    <div className="text-om-muted border-om-border/60 flex h-6 items-center border-t px-3 text-[10px] tracking-[0.04em] uppercase">
      {label}
    </div>
  );
}

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

/** A card row that opens its backing file in the source pane. */
function RowButton({
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

/** One `DENY  Edit(foo.ts)  from <rule> · <layer> · <file>` line. */
function VerdictRow({
  decision,
  call,
  callTitle,
  explanation,
  active,
  onOpen,
}: {
  decision: PermissionDecision;
  call: string;
  /** Full `Tool(path)` text for the tooltip when `call` is just the tool name. */
  callTitle?: string;
  explanation: string;
  active: boolean;
  /** Omitted when no rule backs the verdict, which makes the row inert. */
  onOpen?: () => void;
}) {
  const body = (
    <>
      <Badge
        variant={DECISION_VARIANT[decision]}
        className="w-[46px] shrink-0 justify-center"
      >
        {decision.toUpperCase()}
      </Badge>
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={callTitle ?? call}>
        {call}
      </span>
      <span
        className="text-om-muted shrink-0 text-[11px] whitespace-nowrap"
        title={explanation}
      >
        {explanation}
      </span>
    </>
  );

  if (!onOpen) {
    return (
      <div className="border-om-border/60 flex h-[30px] w-full shrink-0 items-center gap-2.5 border-t px-3 first:border-t-0">
        {body}
      </div>
    );
  }

  return (
    <RowButton active={active} height="h-[30px]" title={explanation} onClick={onOpen}>
      {body}
    </RowButton>
  );
}

function InstructionRow({
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
  /** Key of the row currently shown in the source pane, if any. */
  activeSourceKey: string | null;
  onOpenSource: (target: SourceTarget) => void;
}

export function ContextView({
  context,
  detail,
  folder,
  file,
  homeDir,
  loading,
  activeSourceKey,
  onOpenSource,
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
    ? (["Edit", "Read", "Write"] as const).map((tool) => {
        const rule = winningRuleFor(context, tool);
        return {
          tool,
          decision: verdictFor(context, tool),
          call: `${tool}(${rel})`,
          rule,
        };
      })
    : [];
  // Deny rules that hit this file (or something it imports) and were not
  // overridden, minus any already shown as a resolved verdict above.
  const denyRules = context
    ? matchingDenyRules(context).filter(
        (rule) => !verdicts.some((verdict) => verdict.call === rule.rule),
      )
    : [];
  // Rules whose specifier hits this file, overridden ones included.
  const matching = context
    ? context.permissions.filter((rule) => rule.matchesFile)
    : [];
  const settingsFiles: SettingsEntry[] = context
    ? [...context.settings].sort(
        (a, b) => layerRank(a.layer) - layerRank(b.layer),
      )
    : [];

  return (
    <ScrollArea className="flex flex-1 flex-col gap-3.5 px-5 py-4">
      <div className="flex shrink-0 flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <button
            type="button"
            onClick={() => onOpenSource({ key: `file:${file}`, path: file })}
            title="View file source"
            className="group flex cursor-pointer flex-wrap items-baseline gap-2 text-left"
          >
            <span className="text-om-muted font-mono text-xs">{dirLabel}</span>
            <span
              className={`font-mono text-[17px] font-medium underline-offset-4 group-hover:underline ${
                activeSourceKey === `file:${file}`
                  ? "text-om-amber"
                  : "group-hover:text-om-amber"
              }`}
              title={rel}
            >
              {name}
            </span>
          </button>
          <span className="text-om-muted text-[11px]">
            {languageOf(name)}
            {detail ? ` · ${detail.lines} lines` : ""}
            {detail?.truncated ? " (truncated)" : ""}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3.5">
        <Panel
          icon={<DocIcon className="text-om-muted" />}
          title="Instructions"
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
            instructions.map((entry) => {
              const key = `${entry.kind}:${entry.path}:${entry.importedAtLine ?? 0}`;
              return (
                <InstructionRow
                  key={key}
                  entry={entry}
                  folder={folder}
                  homeDir={homeDir}
                  active={activeSourceKey === key}
                  onOpen={() =>
                    onOpenSource({
                      key,
                      path: entry.path,
                      layer: entry.layer,
                      ...(entry.kind === "import" &&
                      entry.importedAtLine &&
                      entry.importedBy
                        ? {
                            importedAt: {
                              line: entry.importedAtLine,
                              parent: entry.importedBy,
                            },
                          }
                        : {}),
                    })
                  }
                />
              );
            })
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
              <RowButton
                key={entry.path}
                active={activeSourceKey === `memory:${entry.path}`}
                height="h-8"
                title={entry.path}
                onClick={() =>
                  onOpenSource({
                    key: `memory:${entry.path}`,
                    path: entry.path,
                    layer: entry.layer,
                  })
                }
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
              </RowButton>
            ))
          )}
        </Panel>

        <Panel
          icon={<ShieldIcon className="text-om-muted" />}
          title="Permissions"
          note={
            context
              ? `${matching.length} matching of ${context.permissions.length} rules`
              : undefined
          }
        >
          {!context ? (
            <EmptyRow text={loading ? "Resolving…" : "No verdicts resolved."} />
          ) : (
            <>
              {verdicts.map((verdict) => {
                const rule = verdict.rule;
                const key = `verdict:${verdict.tool}`;
                return (
                  <VerdictRow
                    key={key}
                    decision={verdict.decision}
                    call={verdict.tool}
                    callTitle={verdict.call}
                    explanation={
                      rule
                        ? `from ${rule.rule} · ${layerLabel(rule.layer)} · ${projectPath(
                            rule.path,
                            folder,
                            homeDir,
                          )}`
                        : "no rule matches · Claude Code will prompt"
                    }
                    active={activeSourceKey === key}
                    onOpen={
                      rule
                        ? () =>
                            onOpenSource({
                              key,
                              path: rule.path,
                              layer: rule.layer,
                              matches: [`"${rule.rule}"`, rule.rule],
                            })
                        : undefined
                    }
                  />
                );
              })}
              {denyRules.map((rule, index) => {
                const key = `verdict:deny:${rule.path}:${rule.rule}:${index}`;
                return (
                  <VerdictRow
                    key={key}
                    decision="deny"
                    call={rule.rule}
                    explanation={`from ${rule.rule} · ${layerLabel(rule.layer)} · ${projectPath(
                      rule.path,
                      folder,
                      homeDir,
                    )}`}
                    active={activeSourceKey === key}
                    onOpen={() =>
                      onOpenSource({
                        key,
                        path: rule.path,
                        layer: rule.layer,
                        matches: [`"${rule.rule}"`, rule.rule],
                      })
                    }
                  />
                );
              })}

              <SectionDivider label="Matching rules" />
              {matching.length === 0 ? (
                <EmptyRow text="No rule matches this file." />
              ) : (
                matching.map((rule, index) => {
                  const note = ruleNote(rule);
                  const key = `permission:${rule.path}:${rule.rule}:${index}`;
                  return (
                    <RowButton
                      key={key}
                      active={activeSourceKey === key}
                      height="h-[30px]"
                      title={rule.path}
                      onClick={() =>
                        onOpenSource({
                          key,
                          path: rule.path,
                          layer: rule.layer,
                          matches: [`"${rule.rule}"`, rule.rule],
                        })
                      }
                    >
                      <Badge
                        variant={DECISION_VARIANT[rule.decision]}
                        className="w-[46px] shrink-0 justify-center"
                      >
                        {rule.decision}
                      </Badge>
                      <span
                        className={`min-w-0 flex-1 truncate font-mono text-xs ${
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
                })
              )}

              <SectionDivider label="Settings files" />
              {settingsFiles.length === 0 ? (
                <EmptyRow text="No settings files found." />
              ) : (
                settingsFiles.map((entry) => {
                  const key = `settings:${entry.path}`;
                  const count = context.permissions.filter(
                    (rule) => rule.path === entry.path,
                  ).length;
                  return (
                    <RowButton
                      key={key}
                      active={activeSourceKey === key}
                      height="h-[30px]"
                      title={entry.path}
                      onClick={() =>
                        onOpenSource({
                          key,
                          path: entry.path,
                          layer: entry.layer,
                        })
                      }
                    >
                      <Badge className="w-[66px] shrink-0 justify-center">
                        {layerLabel(entry.layer)}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {projectPath(entry.path, folder, homeDir)}
                      </span>
                      <span className="text-om-muted shrink-0 text-[11px]">
                        {`${count} rule${count === 1 ? "" : "s"}`}
                      </span>
                    </RowButton>
                  );
                })
              )}
            </>
          )}
        </Panel>

        <Panel
          icon={<HookIcon className="text-om-teal" />}
          title="Hooks"
          note="on Edit of this path"
        >
          {hooks.length === 0 ? (
            <EmptyRow text="No hooks fire on an Edit of this file." />
          ) : (
            hooks.map((hook, index) => (
              <RowButton
                key={`${hook.path}:${hook.event}:${index}`}
                active={
                  activeSourceKey ===
                  `hook:${hook.path}:${hook.event}:${index}`
                }
                height="h-8"
                title={hook.path}
                onClick={() =>
                  onOpenSource({
                    key: `hook:${hook.path}:${hook.event}:${index}`,
                    path: hook.path,
                    layer: hook.layer,
                    matches: [`"${hook.command}"`, hook.command],
                  })
                }
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
              </RowButton>
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
