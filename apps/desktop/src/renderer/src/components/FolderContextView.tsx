import { Badge, ScrollArea } from "@agentview/ui";
import type {
  ConfigLayer,
  MemoryEntry,
  PermissionRule,
  ResolvedContext,
} from "@agentview/core";

import type { FolderMemorySplit } from "../lib/derive";
import {
  instructionEntries,
  layerLabel,
  memoryEntries,
  ruleTargetsFolder,
  splitFolderMemory,
} from "../lib/derive";
import { basename, dirname, displayPath, projectPath } from "../lib/paths";
import type { SourceTarget } from "../hooks/useSource";
import {
  Diagnostics,
  EmptyRow,
  LoadingGlyph,
  LoadingLegend,
  Panel,
  PermissionRow,
  RowButton,
  SectionDivider,
  SETTINGS_LAYER_ORDER,
  InstructionRow,
  ruleSourceMatches,
} from "./ContextPanels";
import {
  DocIcon,
  ExternalLinkIcon,
  HookIcon,
  LogoIcon,
  MemoryIcon,
  PlayIcon,
  ShieldIcon,
} from "./Icons";

/** `3 rules` / `1 rule`. */
function count(total: number, noun: string): string {
  return `${total} ${noun}${total === 1 ? "" : "s"}`;
}

/** Everything below the folder-specific panel comes from the project. */
function projectWide(note: string): string {
  return `project-wide · ${note}`;
}

/** Rules that hit this folder, bucketed by layer in precedence order. */
function groupByLayer(
  rules: PermissionRule[],
): { layer: ConfigLayer; rules: PermissionRule[] }[] {
  return SETTINGS_LAYER_ORDER.map((layer) => ({
    layer,
    rules: rules.filter((rule) => rule.layer === layer),
  })).filter((group) => group.rules.length > 0);
}

interface RowListProps {
  folder: string;
  homeDir: string;
  activeSourceKey: string | null;
  onOpenSource: (target: SourceTarget) => void;
}

/** Instruction rows, each wired to open its file in the source pane. */
function InstructionRows({
  entries,
  folder,
  homeDir,
  activeSourceKey,
  onOpenSource,
}: RowListProps & { entries: MemoryEntry[] }) {
  return (
    <>
      {entries.map((entry) => {
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
      })}
    </>
  );
}

/** Permission rows, each wired to open its settings file in the source pane. */
function PermissionRows({
  rules,
  keyPrefix,
  folder,
  homeDir,
  activeSourceKey,
  onOpenSource,
}: RowListProps & { rules: PermissionRule[]; keyPrefix: string }) {
  return (
    <>
      {rules.map((rule, index) => {
        const key = `${keyPrefix}:${rule.layer}:${rule.path}:${rule.rule}:${index}`;
        return (
          <PermissionRow
            key={key}
            rule={rule}
            targetKind="directory"
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
      })}
    </>
  );
}

interface FolderContextViewProps {
  context: ResolvedContext | null;
  /** Project root. */
  folder: string;
  /** Absolute path of the selected folder. */
  target: string;
  homeDir: string;
  loading: boolean;
  activeSourceKey: string | null;
  onOpenSource: (target: SourceTarget) => void;
}

/**
 * What an agent already carries when it walks into a folder: the instructions
 * loaded for it, every permission rule that could cover something inside it,
 * and the hooks, skills, subagents and MCP servers available there.
 *
 * Deliberately has no verdict rows — there is no tool call to judge yet.
 */
export function FolderContextView({
  context,
  folder,
  target,
  homeDir,
  loading,
  activeSourceKey,
  onOpenSource,
}: FolderContextViewProps) {
  const isRoot = target === folder;
  const label = isRoot ? basename(folder) : displayPath(target, folder, homeDir);

  // Same split as the file view: CLAUDE.md and its imports here, memory files
  // in their own panel.
  const instructions = context ? instructionEntries(context) : [];
  const memoryFiles = context ? memoryEntries(context) : [];
  const matching = (context?.permissions ?? []).filter(
    (rule) => rule.matchesFile,
  );

  // Root sees one undivided list per panel; a subfolder leads with what it adds
  // on top of the root and shows the rest as inherited.
  const split: FolderMemorySplit = isRoot
    ? { own: [], inherited: instructions }
    : splitFolderMemory(instructions, target);
  const folderRules = isRoot
    ? []
    : matching.filter((rule) =>
        ruleTargetsFolder(rule, folder, target, homeDir),
      );
  const inheritedRules = matching.filter((rule) => !folderRules.includes(rule));
  const groups = groupByLayer(isRoot ? matching : inheritedRules);
  const rowProps = { folder, homeDir, activeSourceKey, onOpenSource };
  const hooks = context?.hooks ?? [];
  const skills = context?.skills ?? [];
  const agents = context?.agents ?? [];
  const servers = context?.mcpServers ?? [];

  return (
    <ScrollArea className="flex flex-1 flex-col gap-3.5 px-5 py-4">
      <div className="flex shrink-0 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[17px] font-medium" title={target}>
            {label}
            {isRoot ? "" : "/"}
          </span>
          <Badge variant="amber">folder</Badge>
        </div>
        <p className="text-om-muted text-xs">
          {isRoot
            ? "What Claude Code sees before it touches any file here."
            : "Inherits the project root, plus what is listed first."}
        </p>
      </div>

      <div className="flex flex-col gap-3.5">
        <Panel
          icon={<DocIcon className="text-om-muted" />}
          title="Instructions"
          note={
            isRoot
              ? instructions.length > 0
                ? `${instructions.length} ${instructions.length === 1 ? "entry" : "entries"} · ordered by precedence, lowest first`
                : undefined
              : `${split.own.length} added here · ${split.inherited.length} inherited`
          }
        >
          {isRoot ? (
            instructions.length === 0 ? (
              <EmptyRow
                text={
                  loading ? "Resolving…" : "No CLAUDE.md applies to this folder."
                }
              />
            ) : (
              <InstructionRows entries={instructions} {...rowProps} />
            )
          ) : (
            <>
              {split.own.length === 0 ? (
                <EmptyRow
                  text={
                    loading ? "Resolving…" : "Nothing added by this folder."
                  }
                />
              ) : (
                <>
                  <SectionDivider label="added by this folder" />
                  <InstructionRows entries={split.own} {...rowProps} />
                </>
              )}
              <SectionDivider label="inherited" />
              {split.inherited.length === 0 ? (
                <EmptyRow
                  text={
                    loading
                      ? "Resolving…"
                      : "No CLAUDE.md applies to this folder."
                  }
                />
              ) : (
                <InstructionRows entries={split.inherited} {...rowProps} />
              )}
            </>
          )}
        </Panel>

        <Panel
          icon={<MemoryIcon className="text-om-muted" />}
          title="Memory"
          note={
            memoryFiles[0] ? (
              <span className="font-mono">
                {displayPath(dirname(memoryFiles[0].path), null, homeDir)}/
              </span>
            ) : undefined
          }
        >
          {memoryFiles.length === 0 ? (
            <EmptyRow text="No memory files for this project." />
          ) : (
            memoryFiles.map((entry) => (
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
                  {entry.content?.split("\n").find((line) => line.trim() !== "")
                    ?.trim()}
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
              ? isRoot
                ? `${matching.length} of ${count(context.permissions.length, "rule")} could apply here`
                : `${folderRules.length} for this folder · ${inheritedRules.length} inherited · of ${count(context.permissions.length, "rule")}`
              : undefined
          }
        >
          {matching.length === 0 ? (
            <EmptyRow
              text={loading ? "Resolving…" : "No rule reaches into this folder."}
            />
          ) : (
            <>
              {isRoot || folderRules.length === 0 ? null : (
                <>
                  <SectionDivider label="this folder" />
                  <PermissionRows
                    rules={folderRules}
                    keyPrefix="folder-permission"
                    {...rowProps}
                  />
                </>
              )}
              {isRoot ? null : <SectionDivider label="inherited" />}
              {!isRoot && inheritedRules.length === 0 ? (
                <EmptyRow text="No inherited rule reaches into this folder." />
              ) : null}
              {groups.map((group) => (
                <div key={group.layer} className="flex flex-col">
                  <SectionDivider label={layerLabel(group.layer).toLowerCase()} />
                  <PermissionRows
                    rules={group.rules}
                    keyPrefix="permission"
                    {...rowProps}
                  />
                </div>
              ))}
            </>
          )}
        </Panel>

        <Panel
          icon={<HookIcon className="text-om-muted" />}
          title="Hooks"
          note={isRoot
            ? count(hooks.length, "hook")
            : projectWide(count(hooks.length, "hook"))}
        >
          {hooks.length === 0 ? (
            <EmptyRow text="No hooks are registered." />
          ) : (
            hooks.map((hook, index) => {
              const key = `hook:${hook.path}:${hook.event}:${index}`;
              return (
                <RowButton
                  key={key}
                  active={activeSourceKey === key}
                  height="h-8"
                  title={hook.path}
                  onClick={() =>
                    onOpenSource({
                      key,
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
                </RowButton>
              );
            })
          )}
        </Panel>

        <Panel
          icon={<PlayIcon className="text-om-muted" />}
          title="Skills"
          note={isRoot
            ? count(skills.length, "skill")
            : projectWide(count(skills.length, "skill"))}
        >
          {skills.length === 0 ? (
            <EmptyRow text="No skills are available here." />
          ) : (
            skills.map((skill) => {
              const key = `skill:${skill.path}`;
              return (
                <RowButton
                  key={key}
                  active={activeSourceKey === key}
                  height="h-8"
                  title={skill.path}
                  onClick={() =>
                    onOpenSource({
                      key,
                      path: skill.path,
                      layer: skill.layer,
                    })
                  }
                >
                  <Badge className="w-[66px] shrink-0 justify-center">
                    {layerLabel(skill.layer)}
                  </Badge>
                  <span className="w-[150px] shrink-0 truncate font-mono text-xs">
                    {skill.name}
                  </span>
                  <span className="text-om-muted min-w-0 flex-1 truncate text-[11px]">
                    {skill.description ?? projectPath(skill.path, folder, homeDir)}
                  </span>
                </RowButton>
              );
            })
          )}
        </Panel>

        <Panel
          icon={<LogoIcon className="text-om-muted" />}
          title="Subagents"
          note={isRoot
            ? count(agents.length, "subagent")
            : projectWide(count(agents.length, "subagent"))}
        >
          {agents.length === 0 ? (
            <EmptyRow text="No subagents are defined." />
          ) : (
            agents.map((agent) => {
              const key = `agent:${agent.path}`;
              return (
                <RowButton
                  key={key}
                  active={activeSourceKey === key}
                  height="h-8"
                  title={agent.path}
                  onClick={() =>
                    onOpenSource({
                      key,
                      path: agent.path,
                      layer: agent.layer,
                    })
                  }
                >
                  <Badge className="w-[66px] shrink-0 justify-center">
                    {layerLabel(agent.layer)}
                  </Badge>
                  <span className="w-[150px] shrink-0 truncate font-mono text-xs">
                    {agent.name}
                  </span>
                  <span className="text-om-muted min-w-0 flex-1 truncate text-[11px]">
                    {agent.description ?? projectPath(agent.path, folder, homeDir)}
                  </span>
                </RowButton>
              );
            })
          )}
        </Panel>

        <Panel
          icon={<ExternalLinkIcon className="text-om-muted" />}
          title="MCP servers"
          note={isRoot
            ? count(servers.length, "server")
            : projectWide(count(servers.length, "server"))}
        >
          {servers.length === 0 ? (
            <EmptyRow text="No MCP servers are configured." />
          ) : (
            servers.map((server) => {
              const key = `mcp:${server.path}:${server.name}`;
              return (
                <RowButton
                  key={key}
                  active={activeSourceKey === key}
                  height="h-8"
                  title={server.path}
                  onClick={() =>
                    onOpenSource({
                      key,
                      path: server.path,
                      layer: server.layer,
                      matches: [`"${server.name}"`],
                    })
                  }
                >
                  <Badge className="w-[66px] shrink-0 justify-center">
                    {layerLabel(server.layer)}
                  </Badge>
                  <span className="w-[150px] shrink-0 truncate font-mono text-xs">
                    {server.name}
                  </span>
                  <Badge variant="teal" className="w-[52px] shrink-0 justify-center">
                    {server.transport}
                  </Badge>
                  <span
                    className="text-om-muted min-w-0 flex-1 truncate font-mono text-[11px]"
                    title={server.target}
                  >
                    {server.target ?? projectPath(server.path, folder, homeDir)}
                  </span>
                </RowButton>
              );
            })
          )}
        </Panel>

        <Diagnostics diagnostics={context?.diagnostics ?? []} />

        {context ? <LoadingLegend /> : null}
      </div>
    </ScrollArea>
  );
}
