import { Badge, ScrollArea } from "@agentpov/ui";
import type {
  ConfigLayer,
  MemoryEntry,
  PermissionRule,
  ResolvedContext,
  SkillEntry,
} from "@agentpov/core";

import type { FolderMemorySplit } from "../lib/derive";
import {
  instructionEntries,
  isOff,
  layerLabel,
  memoryEntries,
  noInstructionsText,
  overridingDecisionFor,
  ruleTargetsFolder,
  splitFolderMemory,
} from "../lib/derive";
import { basename, dirname, displayPath } from "../lib/paths";
import type { SourceTarget } from "../hooks/useSource";
import {
  AgentRow,
  Diagnostics,
  EmptyRow,
  HookRow,
  InstructionFilesRow,
  LoadingGlyph,
  OutputStyleRow,
  PluginRow,
  SessionSettingsRow,
  SettingRow,
  WorkflowRow,
  hookSource,
  instructionKey,
  instructionSource,
  settingSource,
  LoadingLegend,
  McpServerRow,
  Panel,
  PermissionRow,
  RowButton,
  SectionDivider,
  SETTINGS_LAYER_ORDER,
  SKILL_GROUP_THRESHOLD,
  SKILL_SOURCE_LABEL,
  InstructionRow,
  SkillRow,
  groupSkillsBySource,
  ruleSourceMatches,
} from "./ContextPanels";
import {
  DocIcon,
  ExternalLinkIcon,
  FlowIcon,
  HookIcon,
  LogoIcon,
  MemoryIcon,
  PlayIcon,
  PluginIcon,
  ShieldIcon,
  StyleIcon,
} from "./Icons";
import { SandboxPanel } from "./SandboxPanel";

/** `3 rules` / `1 rule`. */
function count(total: number, noun: string): string {
  return `${total} ${noun}${total === 1 ? "" : "s"}`;
}

/** Everything below the folder-specific panel comes from the project. */
function projectWide(note: string): string {
  return `project-wide · ${note}`;
}

/** `12 skills · 2 shadowed · 1 disabled`: the total, then what is out of play. */
function panelNote(
  total: number,
  noun: string,
  parts: [number, string][],
): string {
  return [
    count(total, noun),
    ...parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`),
  ].join(" · ");
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
        const key = instructionKey(entry);
        return (
          <InstructionRow
            key={key}
            entry={entry}
            folder={folder}
            homeDir={homeDir}
            active={activeSourceKey === key}
            onOpen={() => onOpenSource(instructionSource(entry, key))}
          />
        );
      })}
    </>
  );
}

/** Skill rows, each wired to open its SKILL.md in the source pane. */
function SkillRows({
  skills,
  folder,
  homeDir,
  activeSourceKey,
  onOpenSource,
}: RowListProps & { skills: SkillEntry[] }) {
  return (
    <>
      {skills.map((skill) => {
        const key = `skill:${skill.path}`;
        return (
          <SkillRow
            key={key}
            skill={skill}
            folder={folder}
            homeDir={homeDir}
            active={activeSourceKey === key}
            onOpen={() =>
              onOpenSource({ key, path: skill.path, layer: skill.layer })
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
  allRules,
  keyPrefix,
  folder,
  homeDir,
  activeSourceKey,
  onOpenSource,
}: RowListProps & {
  rules: PermissionRule[];
  /** Every rule in the context, so an overridden row can name what beat it. */
  allRules: PermissionRule[];
  keyPrefix: string;
}) {
  return (
    <>
      {rules.map((rule, index) => {
        const key = `${keyPrefix}:${rule.layer}:${rule.path}:${rule.rule}:${index}`;
        return (
          <PermissionRow
            key={key}
            rule={rule}
            targetKind="directory"
            strongerDecision={overridingDecisionFor(allRules, rule)}
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
  const allRules = context?.permissions ?? [];
  const matching = allRules.filter((rule) => rule.matchesFile);

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
  const skillGroups = groupSkillsBySource(skills);

  const plugins = [...(context?.plugins ?? [])].sort(
    (a, b) => Number(b.enabled) - Number(a.enabled),
  );
  const outputStyles = context?.outputStyles ?? [];
  const workflows = context?.workflows ?? [];
  const styleSetting = context?.effective?.outputStyle;
  // A built-in style (Default, Explanatory, Learning) has no file to list.
  const builtInStyle =
    styleSetting && !outputStyles.some((style) => style.active)
      ? styleSetting.value
      : null;
  const ignoredRules = allRules.filter((rule) => rule.ignored).length;

  // Panel notes lead with the total, then what is not actually in play.
  const skillNote = panelNote(skills.length, "skill", [
    [skills.filter((skill) => skill.shadowedBy).length, "shadowed"],
    [skills.filter((skill) => skill.disabled).length, "disabled"],
  ]);
  const agentNote = panelNote(agents.length, "subagent", [
    [agents.filter((agent) => agent.shadowedBy).length, "shadowed"],
    [agents.filter((agent) => agent.disabled).length, "disabled"],
  ]);
  const serverNote = panelNote(servers.length, "server", [
    [servers.filter((server) => server.state === "disabled").length, "disabled"],
    [servers.filter((server) => server.state === "blocked").length, "blocked"],
    [servers.filter((server) => server.state === "unapproved").length, "unapproved"],
  ]);
  const hookNote = panelNote(hooks.length, "hook", [
    [hooks.filter((hook) => hook.disabled).length, "disabled"],
  ]);
  const pluginNote = panelNote(plugins.length, "plugin", [
    [plugins.filter((plugin) => !plugin.enabled).length, "off"],
  ]);
  const workflowNote = panelNote(workflows.length, "workflow", [
    [workflows.filter(isOff).length, "off"],
  ]);
  const activeStyle =
    outputStyles.find((style) => style.active)?.name ?? builtInStyle ?? "Default";

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
        {context ? <SessionSettingsRow context={context} {...rowProps} /> : null}
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
          {context ? <InstructionFilesRow context={context} {...rowProps} /> : null}
          {isRoot ? (
            instructions.length === 0 ? (
              <EmptyRow
                text={loading ? "Resolving…" : noInstructionsText(context, "folder")}
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
                  text={loading ? "Resolving…" : noInstructionsText(context, "folder")}
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
              ? `${
                  isRoot
                    ? `${matching.length} of ${count(context.permissions.length, "rule")} could apply here`
                    : `${folderRules.length} for this folder · ${inheritedRules.length} inherited · of ${count(context.permissions.length, "rule")}`
                }${ignoredRules > 0 ? ` · ${ignoredRules} ignored` : ""}`
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
                    allRules={allRules}
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
                    allRules={allRules}
                    keyPrefix="permission"
                    {...rowProps}
                  />
                </div>
              ))}
            </>
          )}
        </Panel>

        <SandboxPanel
          sandbox={context?.sandbox}
          targetKind="directory"
          {...rowProps}
        />

        <Panel
          icon={<HookIcon className="text-om-muted" />}
          title="Hooks"
          note={isRoot ? hookNote : projectWide(hookNote)}
        >
          {hooks.length === 0 ? (
            <EmptyRow text="No hooks are registered." />
          ) : (
            hooks.map((hook, index) => {
              const key = `hook:${hook.path}:${hook.event}:${index}`;
              return (
                <HookRow
                  key={key}
                  hook={hook}
                  active={activeSourceKey === key}
                  onOpen={() => onOpenSource(hookSource(hook, key))}
                />
              );
            })
          )}
        </Panel>

        {context ? (
          <Panel
            icon={<PluginIcon className="text-om-muted" />}
            title="Plugins"
            note={isRoot ? pluginNote : projectWide(pluginNote)}
          >
            {plugins.length === 0 ? (
              <EmptyRow text="No plugins are installed." />
            ) : (
              plugins.map((plugin) => {
                const key = `plugin:${plugin.id}`;
                return (
                  <PluginRow
                    key={key}
                    plugin={plugin}
                    context={context}
                    active={activeSourceKey === key}
                    onOpen={() =>
                      onOpenSource({
                        key,
                        path: plugin.stateSource ?? plugin.path,
                        layer: plugin.layer,
                        matches: [`"${plugin.id}"`, `"${plugin.name}"`],
                      })
                    }
                  />
                );
              })
            )}
          </Panel>
        ) : null}

        <Panel
          icon={<PlayIcon className="text-om-muted" />}
          title="Skills"
          note={isRoot ? skillNote : projectWide(skillNote)}
        >
          {skills.length === 0 ? (
            <EmptyRow text="No skills are available here." />
          ) : skills.length > SKILL_GROUP_THRESHOLD ? (
            // Plugins alone can bring dozens; grouped by where they come from
            // the list stays readable and precedence reads top to bottom.
            skillGroups.map((group) => (
              <div key={group.source} className="flex flex-col">
                <SectionDivider
                  label={`${SKILL_SOURCE_LABEL[group.source]} · ${count(group.skills.length, "skill")}`}
                />
                <SkillRows skills={group.skills} {...rowProps} />
              </div>
            ))
          ) : (
            <SkillRows skills={skills} {...rowProps} />
          )}
        </Panel>

        <Panel
          icon={<LogoIcon className="text-om-muted" />}
          title="Subagents"
          note={isRoot ? agentNote : projectWide(agentNote)}
        >
          {agents.length === 0 ? (
            <EmptyRow text="No subagents are defined." />
          ) : (
            agents.map((agent) => {
              const key = `agent:${agent.path}`;
              return (
                <AgentRow
                  key={key}
                  agent={agent}
                  folder={folder}
                  homeDir={homeDir}
                  active={activeSourceKey === key}
                  onOpen={() =>
                    onOpenSource({
                      key,
                      path: agent.path,
                      layer: agent.layer,
                    })
                  }
                />
              );
            })
          )}
        </Panel>

        <Panel
          icon={<ExternalLinkIcon className="text-om-muted" />}
          title="MCP servers"
          note={isRoot ? serverNote : projectWide(serverNote)}
        >
          {servers.length === 0 ? (
            <EmptyRow text="No MCP servers are configured." />
          ) : (
            servers.map((server) => {
              const key = `mcp:${server.path}:${server.name}`;
              return (
                <McpServerRow
                  key={key}
                  server={server}
                  folder={folder}
                  homeDir={homeDir}
                  active={activeSourceKey === key}
                  onOpen={() =>
                    onOpenSource({
                      key,
                      path: server.path,
                      layer: server.layer,
                      matches: [`"${server.name}"`],
                    })
                  }
                />
              );
            })
          )}
        </Panel>

        {outputStyles.length > 0 || (builtInStyle && styleSetting?.source) ? (
          <Panel
            icon={<StyleIcon className="text-om-muted" />}
            title="Output styles"
            note={`active: ${activeStyle}`}
          >
            {styleSetting?.source ? (
              <SettingRow
                setting={styleSetting}
                value={styleSetting.value}
                folder={folder}
                homeDir={homeDir}
                active={activeSourceKey === "setting:outputStyle"}
                onOpen={() => {
                  const target = settingSource(styleSetting, "setting:outputStyle");
                  if (target) onOpenSource(target);
                }}
              />
            ) : null}
            {outputStyles.map((style) => {
              const key = `style:${style.path}`;
              return (
                <OutputStyleRow
                  key={key}
                  style={style}
                  active={activeSourceKey === key}
                  onOpen={() =>
                    onOpenSource({ key, path: style.path, layer: style.layer })
                  }
                />
              );
            })}
          </Panel>
        ) : null}

        {workflows.length > 0 ? (
          <Panel
            icon={<FlowIcon className="text-om-muted" />}
            title="Workflows"
            note={isRoot ? workflowNote : projectWide(workflowNote)}
          >
            {workflows.map((workflow) => {
              const key = `workflow:${workflow.path}`;
              return (
                <WorkflowRow
                  key={key}
                  workflow={workflow}
                  folder={folder}
                  homeDir={homeDir}
                  active={activeSourceKey === key}
                  onOpen={() =>
                    onOpenSource({ key, path: workflow.path, layer: workflow.layer })
                  }
                />
              );
            })}
          </Panel>
        ) : null}

        <Diagnostics diagnostics={context?.diagnostics ?? []} />

        {context ? <LoadingLegend /> : null}
      </div>
    </ScrollArea>
  );
}
