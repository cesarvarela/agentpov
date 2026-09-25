import { Badge, ScrollArea } from "@agentpov/ui";
import type {
  PermissionDecision,
  ResolvedContext,
  SettingsEntry,
} from "@agentpov/core";

import {
  editHooks,
  instructionEntries,
  layerLabel,
  matchingDenyRules,
  memoryEntries,
  overridingDecisionFor,
  verdictFor,
  winningRuleFor,
} from "../lib/derive";
import {
  basename,
  dirname,
  displayPath,
  languageOf,
  projectPath,
  relativeTo,
} from "../lib/paths";
import type { FileDetail, SelectedTarget } from "../hooks/useProject";
import type { SourceTarget } from "../hooks/useSource";
import {
  DECISION_VARIANT,
  Diagnostics,
  EmptyRow,
  InstructionRow,
  LoadingGlyph,
  LoadingLegend,
  Panel,
  PermissionRow,
  RowButton,
  SectionDivider,
  layerRank,
  ruleSourceMatches,
} from "./ContextPanels";
import { FolderContextView } from "./FolderContextView";
import { DocIcon, HookIcon, MemoryIcon, ShieldIcon } from "./Icons";

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

interface FileContextViewProps {
  context: ResolvedContext | null;
  detail: FileDetail | null;
  folder: string;
  /** Absolute path of the selected file. */
  file: string;
  homeDir: string;
  loading: boolean;
  activeSourceKey: string | null;
  onOpenSource: (target: SourceTarget) => void;
}

/** Everything that shapes an agent's next tool call on one file. */
function FileContextView({
  context,
  detail,
  folder,
  file,
  homeDir,
  loading,
  activeSourceKey,
  onOpenSource,
}: FileContextViewProps) {
  const rel = relativeTo(file, folder) ?? file;
  const dirLabel = `${displayPath(dirname(file), null, homeDir)}/`;
  const name = basename(file);

  const instructions = context ? instructionEntries(context) : [];
  // CLAUDE.md files and `.claude/rules` files; imports are counted inside them.
  const instructionFiles = instructions.filter(
    (entry) => entry.kind === "claude-md" || entry.kind === "rule",
  ).length;
  const ruleFiles = instructions.filter((entry) => entry.kind === "rule").length;
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
              ? `${instructionFiles} files${
                  ruleFiles > 0
                    ? ` · ${ruleFiles} rule${ruleFiles === 1 ? "" : "s"}`
                    : ""
                } · ordered by precedence, lowest first`
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
                <LoadingGlyph loading={entry.loading} reason={entry.reason} />
                <span className="w-[150px] shrink-0 truncate font-mono text-xs">
                  {basename(entry.path)}
                </span>
                <span className="text-om-muted min-w-0 flex-1 truncate text-[11px]">
                  {entry.summary}
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
                              matches: ruleSourceMatches(rule),
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
                        matches: ruleSourceMatches(rule),
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
                  const key = `permission:${rule.path}:${rule.rule}:${index}`;
                  return (
                    <PermissionRow
                      key={key}
                      rule={rule}
                      targetKind="file"
                      strongerDecision={overridingDecisionFor(
                        context.permissions,
                        rule,
                      )}
                      folder={folder}
                      homeDir={homeDir}
                      active={activeSourceKey === key}
                      onOpen={() =>
                        onOpenSource({
                          key,
                          path: rule.path,
                          layer: rule.layer,
                          matches: ruleSourceMatches(rule),
                        })
                      }
                    />
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
          icon={<HookIcon className="text-om-muted" />}
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
                <span className="text-om-text w-[92px] shrink-0 text-[11px] font-medium">
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

        <Diagnostics diagnostics={context?.diagnostics ?? []} />

        {context ? <LoadingLegend /> : null}
      </div>
    </ScrollArea>
  );
}

interface ContextViewProps {
  context: ResolvedContext | null;
  detail: FileDetail | null;
  folder: string;
  /** Selected tree row; a folder gets the folder view, a file the file view. */
  target: SelectedTarget | null;
  homeDir: string;
  loading: boolean;
  /** Key of the row currently shown in the source pane, if any. */
  activeSourceKey: string | null;
  onOpenSource: (target: SourceTarget) => void;
}

/** Picks the file or the folder view for whatever the tree has selected. */
export function ContextView({
  context,
  detail,
  folder,
  target,
  homeDir,
  loading,
  activeSourceKey,
  onOpenSource,
}: ContextViewProps) {
  if (!target) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <p className="text-om-text text-sm">Open a folder to get started.</p>
        <p className="text-om-muted max-w-sm text-xs">
          agentpov will show the instructions, memory, permission rules and
          hooks that apply to it.
        </p>
      </div>
    );
  }

  if (target.kind === "directory") {
    return (
      <FolderContextView
        context={context}
        folder={folder}
        target={target.path}
        homeDir={homeDir}
        loading={loading}
        activeSourceKey={activeSourceKey}
        onOpenSource={onOpenSource}
      />
    );
  }

  return (
    <FileContextView
      context={context}
      detail={detail}
      folder={folder}
      file={target.path}
      homeDir={homeDir}
      loading={loading}
      activeSourceKey={activeSourceKey}
      onOpenSource={onOpenSource}
    />
  );
}
