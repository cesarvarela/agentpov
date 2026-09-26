import type { ReactNode } from "react";
import { Badge } from "@agentpov/ui";
import type {
  AgentEntry,
  ConfigLayer,
  EffectiveValue,
  HookEntry,
  McpServerEntry,
  MemoryEntry,
  MemoryLoading,
  OutputStyleEntry,
  PermissionDecision,
  PermissionRule,
  PluginEntry,
  ResolvedContext,
  SkillEntry,
  SkillSource,
  TargetKind,
  WorkflowEntry,
} from "@agentpov/core";

import type { SourceTarget } from "../hooks/useSource";
import {
  DEFAULT_INSTRUCTION_FILES,
  INSTRUCTION_FILES_LABEL,
  contributionSummary,
  hookOrigin,
  hookScope,
  isMcpOff,
  layerLabel,
  pluginContributions,
  sessionSettings,
  settingKeyName,
  settingProvenance,
} from "../lib/derive";
import { basename, formatBytes, relativeTo, rowPath } from "../lib/paths";
import {
  ImportIcon,
  LoadAlwaysIcon,
  LoadOnDemandIcon,
  LoadOnReadIcon,
  WarningIcon,
} from "./Icons";

/** Badge colour per permission decision. */
export const DECISION_VARIANT = {
  allow: "allow",
  ask: "ask",
  deny: "deny",
} as const;

/**
 * Single source of truth for how a loading mode is drawn: glyph, colour class
 * and the wording used in the tooltip, the aria label and the legend.
 *
 * Teal/solid is always in context; the two lazy modes share violet and are told
 * apart by shape — half-filled is pulled in when a file under it is read,
 * dashed is only recalled on demand. Amber is the app's accent and orange is
 * agent identity, so neither appears here.
 */
export const LOADING_MODES = {
  always: {
    Icon: LoadAlwaysIcon,
    className: "text-om-teal",
    label: "always",
    legend: "always loaded",
  },
  "on-read": {
    Icon: LoadOnReadIcon,
    className: "text-om-violet",
    label: "on read",
    legend: "loaded when a file under it is read",
  },
  "on-demand": {
    Icon: LoadOnDemandIcon,
    className: "text-om-violet",
    label: "on demand",
    legend: "recalled on demand",
  },
} as const satisfies Record<
  MemoryLoading,
  {
    Icon: (props: { className?: string }) => ReactNode;
    className: string;
    label: string;
    legend: string;
  }
>;

export const LOADING_MODE_ORDER: MemoryLoading[] = [
  "always",
  "on-read",
  "on-demand",
];

/**
 * How Claude Code pulls this file into context, as a 12px glyph in a fixed
 * 16px slot so rows stay aligned. The entry's `reason` rides along as the
 * tooltip; `LoadingLegend` spells the three glyphs out.
 */
export function LoadingGlyph({
  loading,
  reason,
}: {
  loading: MemoryLoading;
  reason: string;
}) {
  const mode = LOADING_MODES[loading];
  return (
    <span
      className={`flex w-4 shrink-0 items-center justify-center ${mode.className}`}
      title={reason}
      aria-label={mode.label}
      role="img"
    >
      <mode.Icon />
    </span>
  );
}

/**
 * What the three loading glyphs mean. Rendered once at the bottom of the
 * scrolled pane, so it inherits the pane's horizontal padding and lines up with
 * the panel edges; it scrolls with the content rather than sticking.
 */
export function LoadingLegend() {
  return (
    <div className="text-om-muted flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-[11px]">
      {LOADING_MODE_ORDER.map((loading) => {
        const mode = LOADING_MODES[loading];
        return (
          <span key={loading} className="flex items-center gap-1.5">
            <span className={`flex w-4 shrink-0 items-center justify-center ${mode.className}`}>
              <mode.Icon />
            </span>
            {mode.legend}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Layers listed highest-precedence first. Kept as a local literal: a runtime
 * import from `@agentpov/core` would drag its Node file-system module into
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
  dim = false,
  height,
  padding = "px-3",
  title,
  onClick,
  children,
}: {
  active: boolean;
  /** Background class for the resting state, if the row has one. */
  bg?: string;
  /**
   * Faded row: the entry is on disk but out of play — a disabled MCP server, a
   * shadowed skill or subagent. Same treatment an overridden rule gets.
   */
  dim?: boolean;
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
        dim ? "opacity-50" : ""
      } ${
        active
          ? "bg-om-amber-bg shadow-[inset_2px_0_0_var(--om-amber)]"
          : `${bg ?? ""} hover:bg-om-raised`
      }`}
    >
      {children}
    </button>
  );
}

/** One CLAUDE.md, `.claude/rules` file, `@import` or memory file row. */
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
  // Directory-layer files get no colour of their own: the DIRECTORY badge and
  // the loading glyph already say what they are, and the folder view groups
  // them under "added by this folder". They only show a shorter, project-
  // relative path.
  const isDirectory = entry.layer === "directory";
  const size = formatBytes(entry.bytes);

  if (entry.kind === "import") {
    return (
      <RowButton
        active={active}
        height="h-7"
        padding="pr-3 pl-[34px]"
        title={entry.path}
        onClick={onOpen}
      >
        <ImportIcon className="text-om-muted shrink-0" />
        <Badge className="w-[52px] shrink-0 justify-center">import</Badge>
        <LoadingGlyph loading={entry.loading} reason={entry.reason} />
        <span className="text-om-muted min-w-0 flex-1 truncate font-mono text-xs">
          {rowPath(entry.path, folder, homeDir)}
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

  // The managed `claudeMd` setting has no file of its own: the row names the
  // setting and opens the managed settings file that holds it.
  if (entry.kind === "inline") {
    return (
      <RowButton
        active={active}
        height="h-[30px]"
        title={`${entry.reason}\n${entry.path}`}
        onClick={onOpen}
      >
        <Badge className="w-[66px] shrink-0 justify-center">
          {layerLabel(entry.layer)}
        </Badge>
        <LoadingGlyph loading={entry.loading} reason={entry.reason} />
        <span className="text-om-text shrink-0 font-mono text-xs">claudeMd</span>
        <span className="text-om-muted min-w-0 flex-1 truncate text-[11px]">
          {entry.summary ?? `in ${basename(entry.path)}`}
        </span>
        <span className="text-om-muted shrink-0 text-[11px]">{size}</span>
      </RowButton>
    );
  }

  const path = isDirectory
    ? (relativeTo(entry.path, folder) ?? entry.path)
    : rowPath(entry.path, folder, homeDir);

  // A `.claude/rules` file with `paths:` only loads when Claude reads a file it
  // covers. The glyph already says "on read"; the second line says what for.
  if (entry.kind === "rule") {
    const globs = entry.appliesToGlobs;
    return (
      <RowButton
        active={active}
        height={globs ? "min-h-[42px] py-1.5" : "h-[30px]"}
        title={entry.path}
        onClick={onOpen}
      >
        <Badge className="w-[66px] shrink-0 justify-center">
          {layerLabel(entry.layer)}
        </Badge>
        <LoadingGlyph loading={entry.loading} reason={entry.reason} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-om-text truncate font-mono text-xs">{path}</span>
          {globs ? (
            <span
              className="text-om-muted truncate font-mono text-[11px]"
              title={globs.join(", ")}
            >
              {globs.join(", ")}
            </span>
          ) : null}
        </span>
        <span className="text-om-muted shrink-0 text-[11px]">{size}</span>
      </RowButton>
    );
  }

  return (
    <RowButton
      active={active}
      height="h-[30px]"
      title={entry.path}
      onClick={onOpen}
    >
      <Badge className="w-[66px] shrink-0 justify-center">
        {layerLabel(entry.layer)}
      </Badge>
      <LoadingGlyph loading={entry.loading} reason={entry.reason} />
      <span className="text-om-text min-w-0 flex-1 truncate font-mono text-xs">
        {path}
      </span>
      {entry.kind === "agents-md" ? (
        <span className="text-om-muted shrink-0 text-[11px]" title={entry.reason}>
          {agentsMdNote(entry.reason)}
        </span>
      ) : null}
      <span className="text-om-muted shrink-0 text-[11px]">{size}</span>
    </RowButton>
  );
}

/**
 * Why an AGENTS.md is in context, in a few words: Claude Code reads it
 * directly (not through an `@import`), either in place of a missing CLAUDE.md
 * or next to it, depending on `instructionFiles`.
 */
function agentsMdNote(reason: string): string {
  if (/instead of CLAUDE\.md/i.test(reason)) return "AGENTS.md, no CLAUDE.md here";
  if (/after|alongside/i.test(reason)) return "AGENTS.md, after CLAUDE.md";
  return "AGENTS.md";
}

/**
 * Right-hand annotation of a permission row.
 *
 * `strongerDecision` is the decision that beat an overridden rule: Claude Code
 * merges every layer into one set and evaluates it deny → ask → allow, so what
 * overrides a rule is a stronger decision, not a higher layer. The layer only
 * says which file to look in.
 */
export function ruleNote(
  rule: PermissionRule,
  targetKind: TargetKind,
  strongerDecision?: PermissionDecision,
): { text: string; className: string } {
  // Dropped before evaluation, so it neither wins nor loses anything.
  if (rule.ignored) {
    return { text: `ignored: ${rule.ignored}`, className: "text-om-muted" };
  }
  if (rule.carvedOutBy) {
    return { text: `carved out by ${rule.carvedOutBy}`, className: "text-om-muted" };
  }
  if (rule.overridden) {
    const where = rule.overriddenBy
      ? `${layerLabel(rule.overriddenBy).toLowerCase()} settings`
      : "another settings file";
    return {
      text: `overridden by ${strongerDecision ?? "a stronger rule"} in ${where}`,
      className: "text-om-amber",
    };
  }
  // Only a managed deny is truly untouchable: deny is the strongest decision
  // and no layer can edit managed settings. A managed allow or ask still loses
  // to a stronger decision anywhere, so it gets the ordinary note.
  if (rule.layer === "managed" && rule.decision === "deny") {
    return { text: "cannot be overridden", className: "text-om-muted" };
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
  strongerDecision,
  folder,
  homeDir,
  active,
  onOpen,
}: {
  rule: PermissionRule;
  targetKind: TargetKind;
  /** Decision that overrode this rule, when it was overridden. */
  strongerDecision?: PermissionDecision;
  folder: string;
  homeDir: string;
  active: boolean;
  onOpen: () => void;
}) {
  const note = ruleNote(rule, targetKind, strongerDecision);
  const outOfPlay = rule.overridden || rule.ignored !== undefined;

  return (
    <RowButton
      active={active}
      dim={rule.ignored !== undefined}
      height="h-[30px]"
      title={rule.ignored ? `ignored: ${rule.ignored}` : rule.path}
      onClick={onOpen}
    >
      <Badge
        variant={DECISION_VARIANT[rule.decision]}
        className={`w-[46px] shrink-0 justify-center ${
          rule.overridden && !rule.ignored ? "opacity-50" : ""
        }`}
      >
        {rule.decision}
      </Badge>
      <span
        className={`min-w-0 flex-1 truncate font-mono text-xs ${
          outOfPlay ? "text-om-muted line-through" : "text-om-text"
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
        {rowPath(rule.path, folder, homeDir)}
      </span>
      <span
        className={`max-w-[40%] shrink-0 truncate text-[11px] ${note.className}`}
        title={note.text}
      >
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

/**
 * Where a skill comes from, in the square layer-badge family: it is structure,
 * like USER or PROJECT, so it stays colourless.
 */
export const SKILL_SOURCE_LABEL = {
  managed: "managed",
  personal: "personal",
  synced: "synced",
  project: "project",
  nested: "nested",
  plugin: "plugin",
  command: "command",
} as const satisfies Record<SkillSource, string>;

/** Sources in the order they are listed, highest precedence first. */
export const SKILL_SOURCE_ORDER: SkillSource[] = [
  "managed",
  "personal",
  "synced",
  "project",
  "nested",
  "plugin",
  "command",
];

/** Above this many skills the panel groups them by source. */
export const SKILL_GROUP_THRESHOLD = 12;

export function groupSkillsBySource(
  skills: SkillEntry[],
): { source: SkillSource; skills: SkillEntry[] }[] {
  return SKILL_SOURCE_ORDER.map((source) => ({
    source,
    skills: skills.filter((skill) => skill.source === source),
  })).filter((group) => group.skills.length > 0);
}

/**
 * Why a skill or subagent is on disk but never used: a higher-precedence file
 * of the same name won. Same wording for both, and the same faded, struck-
 * through treatment an overridden permission rule gets.
 */
function shadowTitle(
  kind: string,
  shadowedBy: ConfigLayer,
  path: string,
): string {
  return `shadowed by ${shadowedBy} ${kind} at ${path}`;
}

/**
 * Why an entry is on disk but out of play, for the row's right-hand note and
 * tooltip: turned off (`disabled`, with core's reason) or shadowed.
 */
function offState(
  kind: string,
  entry: { shadowedBy?: { layer: ConfigLayer; path: string }; disabled?: string },
): { note: string; title: string } | null {
  if (entry.disabled) {
    return { note: entry.disabled, title: `not offered: ${entry.disabled}` };
  }
  if (entry.shadowedBy) {
    return {
      note: `shadowed by ${entry.shadowedBy.layer}`,
      title: shadowTitle(kind, entry.shadowedBy.layer, entry.shadowedBy.path),
    };
  }
  return null;
}

/** Right-hand muted note on an out-of-play row; the tooltip has the rest. */
export function OffNote({ text, title }: { text: string; title?: string }) {
  return (
    <span
      className="text-om-muted max-w-[40%] shrink-0 truncate text-[11px]"
      title={title ?? text}
    >
      {text}
    </span>
  );
}

/** `PROJECT  deploy  Ship the app to staging`, struck through when shadowed. */
export function SkillRow({
  skill,
  folder,
  homeDir,
  active,
  onOpen,
}: {
  skill: SkillEntry;
  folder: string;
  homeDir: string;
  active: boolean;
  onOpen: () => void;
}) {
  const off = offState("skill", skill);
  return (
    <RowButton
      active={active}
      dim={off !== null}
      height="h-8"
      title={off ? off.title : skill.path}
      onClick={onOpen}
    >
      <Badge className="w-[66px] shrink-0 justify-center">
        {SKILL_SOURCE_LABEL[skill.source]}
      </Badge>
      <span
        className={`w-[170px] shrink-0 truncate font-mono text-xs ${
          off ? "text-om-muted line-through" : ""
        }`}
        title={skill.name}
      >
        {skill.name}
      </span>
      <span className="text-om-muted min-w-0 flex-1 truncate text-[11px]">
        {skill.description ?? rowPath(skill.path, folder, homeDir)}
      </span>
      {off ? <OffNote text={off.note} title={off.title} /> : null}
    </RowButton>
  );
}

/** `PROJECT  reviewer  sonnet · 3 tools`, struck through when shadowed. */
export function AgentRow({
  agent,
  folder,
  homeDir,
  active,
  onOpen,
}: {
  agent: AgentEntry;
  folder: string;
  homeDir: string;
  active: boolean;
  onOpen: () => void;
}) {
  const off = offState("subagent", agent);
  // Model and tool count only; the source pane shows the whole frontmatter.
  const facts = [
    agent.model,
    agent.tools
      ? `${agent.tools.length} tool${agent.tools.length === 1 ? "" : "s"}`
      : undefined,
  ].filter((fact): fact is string => fact !== undefined);

  return (
    <RowButton
      active={active}
      dim={off !== null}
      height={facts.length > 0 ? "min-h-[42px] py-1.5" : "h-8"}
      title={off ? off.title : agent.path}
      onClick={onOpen}
    >
      <Badge className="w-[66px] shrink-0 justify-center">
        {agent.plugin ? "plugin" : layerLabel(agent.layer)}
      </Badge>
      <span
        className={`w-[150px] shrink-0 truncate font-mono text-xs ${
          off ? "text-om-muted line-through" : ""
        }`}
        title={agent.name}
      >
        {agent.name}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-om-muted truncate text-[11px]">
          {agent.description ?? rowPath(agent.path, folder, homeDir)}
        </span>
        {facts.length > 0 ? (
          <span className="text-om-muted truncate font-mono text-[11px]">
            {facts.join(" · ")}
          </span>
        ) : null}
      </span>
      {off ? <OffNote text={off.note} title={off.title} /> : null}
    </RowButton>
  );
}

/**
 * `PROJECT  fixture-http  http  https://…  env FIXTURE  DISABLED`.
 *
 * State is drawn with the badge families that already exist: a deny pill for a
 * server Claude Code would not load — `disabled` by a settings list, or
 * `blocked` by managed policy whatever the approval says — and a plain
 * layer-style badge for one it would have to ask about first. MCP servers have
 * no colour of their own.
 *
 * Never renders an env value or a header value — they hold secrets. Only the
 * key names show.
 */
export function McpServerRow({
  server,
  folder,
  homeDir,
  active,
  onOpen,
}: {
  server: McpServerEntry;
  folder: string;
  homeDir: string;
  active: boolean;
  onOpen: () => void;
}) {
  const transport = server.type ?? server.transport;
  const keys = [
    ...Object.keys(server.env ?? {}).map((key) => `env ${key}`),
    ...Object.keys(server.headers ?? {}).map((key) => `header ${key}`),
  ];

  return (
    <RowButton
      active={active}
      dim={isMcpOff(server)}
      height="h-8"
      title={server.reason}
      onClick={onOpen}
    >
      <Badge className="w-[66px] shrink-0 justify-center">
        {server.plugin ? "plugin" : layerLabel(server.layer)}
      </Badge>
      <span className="w-[150px] shrink-0 truncate font-mono text-xs">
        {server.name}
      </span>
      {transport === "unknown" ? null : (
        <span className="text-om-muted w-[34px] shrink-0 text-[11px]">
          {transport}
        </span>
      )}
      <span
        className="text-om-muted min-w-0 flex-1 truncate font-mono text-[11px]"
        title={server.target}
      >
        {server.target ?? rowPath(server.path, folder, homeDir)}
      </span>
      {keys.length > 0 ? (
        <span
          className="text-om-muted shrink-0 truncate font-mono text-[11px]"
          title={keys.join(", ")}
        >
          {keys.join(", ")}
        </span>
      ) : null}
      {isMcpOff(server) ? <OffNote text={server.reason} /> : null}
      {server.state === "disabled" || server.state === "blocked" ? (
        <Badge variant="deny" className="shrink-0" title={server.reason}>
          {server.state}
        </Badge>
      ) : null}
      {server.state === "unapproved" ? (
        <Badge className="shrink-0">needs approval</Badge>
      ) : null}
    </RowButton>
  );
}

/** Source-pane target for a permission rule: its line in the settings file. */
export function ruleSourceMatches(rule: PermissionRule): string[] {
  return [`"${rule.rule}"`, rule.rule];
}

/** Badge text for where a hook was declared: its layer, or what declares it. */
const HOOK_SOURCE_BADGE = {
  plugin: "plugin",
  skill: "skill",
  agent: "subagent",
} as const;

/**
 * `PreToolUse  Edit|Write  lint.sh  PROJECT`, with a second line when the hook
 * is not simply a settings hook: which plugin, skill or subagent declares it,
 * when it is registered, and why it would not run. A disabled hook gets the
 * same faded, struck-through treatment as a shadowed skill.
 */
export function HookRow({
  hook,
  showTimeout = false,
  active,
  onOpen,
}: {
  hook: HookEntry;
  showTimeout?: boolean;
  active: boolean;
  onOpen: () => void;
}) {
  const source = hook.source ?? "settings";
  const details = [
    source === "settings" ? null : hookOrigin(hook),
    hookScope(hook),
    hook.disabled ? `disabled: ${hook.disabled}` : null,
  ].filter((part): part is string => part !== null);
  const type = hook.type && hook.type !== "command" ? hook.type : null;

  return (
    <RowButton
      active={active}
      dim={hook.disabled !== undefined}
      height={details.length > 0 ? "min-h-[42px] py-1.5" : "h-8"}
      title={hook.disabled ? `disabled: ${hook.disabled}` : hook.path}
      onClick={onOpen}
    >
      <span className="text-om-text w-[92px] shrink-0 truncate text-[11px] font-medium" title={hook.event}>
        {hook.event}
      </span>
      <span className="text-om-muted w-[86px] shrink-0 truncate font-mono text-[11px]">
        {hook.matcher ?? "*"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`truncate font-mono text-xs ${
            hook.disabled ? "text-om-muted line-through" : ""
          }`}
          title={hook.command}
        >
          {type ? <span className="text-om-muted">{type} </span> : null}
          {hook.command}
        </span>
        {details.length > 0 ? (
          <span className="text-om-muted truncate text-[11px]" title={details.join(" · ")}>
            {details.join(" · ")}
          </span>
        ) : null}
      </span>
      <Badge className="w-[66px] shrink-0 justify-center">
        {source === "settings" ? layerLabel(hook.layer) : HOOK_SOURCE_BADGE[source]}
      </Badge>
      {showTimeout ? (
        <span className="text-om-muted shrink-0 text-[11px]">
          {hook.timeoutSeconds ? `timeout ${hook.timeoutSeconds}s` : "no timeout"}
        </span>
      ) : null}
    </RowButton>
  );
}

/** Source-pane target for a hook row: its command in the declaring file. */
export function hookSource(hook: HookEntry, key: string): SourceTarget {
  return {
    key,
    path: hook.path,
    layer: hook.layer,
    matches: [`"${hook.command}"`, hook.command],
  };
}

/** Source-pane target for an effective setting: its key in the file that set it. */
export function settingSource(
  setting: EffectiveValue<unknown>,
  key: string,
): SourceTarget | null {
  if (!setting.source) return null;
  return {
    key,
    path: setting.source.path,
    layer: setting.source.layer,
    matches: [`"${settingKeyName(setting.key)}"`],
  };
}

/**
 * `mode  acceptEdits` — one session-wide setting as a small square chip, in the
 * layer-badge family: structure, not state, so no colour. Opens the file that
 * set it; inert when the value is Claude Code's default.
 */
export function SettingChip({
  label,
  value,
  title,
  active,
  onOpen,
}: {
  label: string;
  value: string;
  title: string;
  active: boolean;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span className="text-om-muted">{label}</span>
      <span className="text-om-text font-mono">{value}</span>
    </>
  );
  const base =
    "flex h-6 shrink-0 items-center gap-1.5 rounded-[4px] border px-2 text-[11px]";
  if (!onOpen) {
    return (
      <span className={`${base} border-om-border`} title={title}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      className={`${base} cursor-pointer transition-colors ${
        active
          ? "border-om-amber bg-om-amber-bg"
          : "border-om-border hover:bg-om-raised"
      }`}
    >
      {body}
    </button>
  );
}

/**
 * The session-wide switches that change what the panels below mean: the
 * permission mode always, the rest only when they are not Claude Code's
 * default. `instructionFiles` is left to the Instructions panel.
 */
export function SessionSettingsRow({
  context,
  folder,
  homeDir,
  activeSourceKey,
  onOpenSource,
}: {
  context: ResolvedContext;
  folder: string;
  homeDir: string;
  activeSourceKey: string | null;
  onOpenSource: (target: SourceTarget) => void;
}) {
  const items = sessionSettings(context).filter(
    (item) => item.id !== "instructionFiles",
  );
  if (items.length === 0) return null;
  const modeNote = context.effective?.permissionMode.note;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      {items.map((item) => {
        const key = `session:${item.id}`;
        const target = settingSource(item.setting, key);
        return (
          <SettingChip
            key={item.id}
            label={item.label}
            value={item.value}
            title={settingProvenance(item.setting, folder, homeDir)}
            active={activeSourceKey === key}
            onOpen={target ? () => onOpenSource(target) : undefined}
          />
        );
      })}
      {modeNote ? (
        <span className="text-om-muted min-w-0 truncate text-[11px]" title={modeNote}>
          {modeNote}
        </span>
      ) : null}
    </div>
  );
}

/**
 * `instructionFiles  CLAUDE.md and AGENTS.md  PROJECT  .claude/settings.json`:
 * a non-default setting shown at the top of the panel it changes.
 */
export function SettingRow({
  setting,
  value,
  folder,
  homeDir,
  active,
  onOpen,
}: {
  setting: EffectiveValue<unknown>;
  value: string;
  folder: string;
  homeDir: string;
  active: boolean;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <Badge className="w-[66px] shrink-0 justify-center">
        {setting.source ? layerLabel(setting.source.layer) : "default"}
      </Badge>
      <span className="text-om-muted shrink-0 font-mono text-[11px]">
        {settingKeyName(setting.key)}
      </span>
      <span className="text-om-text min-w-0 flex-1 truncate text-xs">{value}</span>
      <span
        className="text-om-muted max-w-[45%] shrink-0 truncate font-mono text-[11px]"
        title={settingProvenance(setting, folder, homeDir)}
      >
        {setting.note ??
          (setting.source ? rowPath(setting.source.path, folder, homeDir) : "")}
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
    <RowButton active={active} height="h-[30px]" title={setting.key} onClick={onOpen}>
      {body}
    </RowButton>
  );
}

/** `instructionFiles` as a row, when it is not the default. */
export function instructionFilesValue(context: ResolvedContext): string {
  return INSTRUCTION_FILES_LABEL[context.effective.instructionFiles.value];
}

/**
 * `USER  superpowers@official  4.1.0  Core skills…  3 skills · 2 hooks`.
 * A disabled plugin is faded with core's reason; it contributes nothing, so
 * its counts are left off.
 */
export function PluginRow({
  plugin,
  context,
  active,
  onOpen,
}: {
  plugin: PluginEntry;
  context: ResolvedContext;
  active: boolean;
  onOpen: () => void;
}) {
  const brings = plugin.enabled
    ? contributionSummary(pluginContributions(context, plugin.name))
    : null;
  const origin =
    plugin.origin === "marketplace"
      ? (plugin.marketplace ?? "marketplace")
      : plugin.origin === "skills-dir"
        ? "skills dir"
        : "synced";

  return (
    <RowButton
      active={active}
      dim={!plugin.enabled}
      height="min-h-[42px] py-1.5"
      title={plugin.reason}
      onClick={onOpen}
    >
      <Badge className="w-[66px] shrink-0 justify-center">
        {layerLabel(plugin.layer)}
      </Badge>
      <span className="flex w-[170px] shrink-0 flex-col">
        <span
          className={`truncate font-mono text-xs ${
            plugin.enabled ? "" : "text-om-muted line-through"
          }`}
          title={plugin.id}
        >
          {plugin.name}
        </span>
        <span className="text-om-muted truncate font-mono text-[11px]" title={plugin.id}>
          {origin}
          {plugin.version ? ` · ${plugin.version}` : ""}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-om-muted truncate text-[11px]" title={plugin.description}>
          {plugin.description ?? ""}
        </span>
        {brings ? (
          <span className="text-om-muted truncate font-mono text-[11px]">{brings}</span>
        ) : null}
      </span>
      {plugin.enabled ? null : <OffNote text={plugin.reason} />}
    </RowButton>
  );
}

/**
 * `PROJECT  ●  terse  Short answers`. The active style carries the teal
 * always-loaded glyph: it is in the system prompt from the first turn, which
 * is exactly what teal means. Inactive styles get an empty glyph slot.
 */
export function OutputStyleRow({
  style,
  active,
  onOpen,
}: {
  style: OutputStyleEntry;
  active: boolean;
  onOpen: () => void;
}) {
  const off = offState("output style", style);
  const facts = [
    style.forceForPlugin ? "forced by plugin" : null,
    style.keepCodingInstructions ? "keeps coding instructions" : null,
  ].filter((fact): fact is string => fact !== null);
  return (
    <RowButton
      active={active}
      dim={off !== null}
      height="h-8"
      title={off ? off.title : style.path}
      onClick={onOpen}
    >
      <Badge className="w-[66px] shrink-0 justify-center">
        {style.plugin ? "plugin" : layerLabel(style.layer)}
      </Badge>
      {style.active ? (
        <LoadingGlyph loading="always" reason="the session's output style" />
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <span
        className={`w-[150px] shrink-0 truncate font-mono text-xs ${
          off ? "text-om-muted line-through" : ""
        }`}
        title={style.name}
      >
        {style.name}
      </span>
      <span className="text-om-muted min-w-0 flex-1 truncate text-[11px]">
        {style.description ?? ""}
      </span>
      {off ? (
        <OffNote text={off.note} title={off.title} />
      ) : facts.length > 0 ? (
        <OffNote text={facts.join(" · ")} />
      ) : null}
    </RowButton>
  );
}

/** `PROJECT  release  Cut a release branch`, faded when workflows are off. */
export function WorkflowRow({
  workflow,
  folder,
  homeDir,
  active,
  onOpen,
}: {
  workflow: WorkflowEntry;
  folder: string;
  homeDir: string;
  active: boolean;
  onOpen: () => void;
}) {
  const off = offState("workflow", workflow);
  return (
    <RowButton
      active={active}
      dim={off !== null}
      height="h-8"
      title={off ? off.title : workflow.path}
      onClick={onOpen}
    >
      <Badge className="w-[66px] shrink-0 justify-center">
        {workflow.plugin ? "plugin" : layerLabel(workflow.layer)}
      </Badge>
      <span
        className={`w-[170px] shrink-0 truncate font-mono text-xs ${
          off ? "text-om-muted line-through" : ""
        }`}
        title={workflow.name}
      >
        {workflow.name}
      </span>
      <span className="text-om-muted min-w-0 flex-1 truncate text-[11px]">
        {workflow.description ?? rowPath(workflow.path, folder, homeDir)}
      </span>
      {off ? <OffNote text={off.note} title={off.title} /> : null}
    </RowButton>
  );
}

/**
 * Source-pane target for an instruction row. The managed `claudeMd` text has
 * no file of its own, so it opens the managed settings file at that key.
 */
export function instructionSource(entry: MemoryEntry, key: string): SourceTarget {
  if (entry.kind === "inline") {
    return { key, path: entry.path, layer: entry.layer, matches: [`"claudeMd"`] };
  }
  return {
    key,
    path: entry.path,
    layer: entry.layer,
    ...(entry.kind === "import" && entry.importedAtLine && entry.importedBy
      ? { importedAt: { line: entry.importedAtLine, parent: entry.importedBy } }
      : {}),
  };
}

/** Key identifying an instruction row, shared by the file and folder views. */
export function instructionKey(entry: MemoryEntry): string {
  return `${entry.kind}:${entry.path}:${entry.importedAtLine ?? 0}`;
}

/**
 * The `instructionFiles` row at the top of the Instructions panel, only when
 * it is not Claude Code's default: it decides whether AGENTS.md loads at all.
 */
export function InstructionFilesRow({
  context,
  folder,
  homeDir,
  activeSourceKey,
  onOpenSource,
}: {
  context: ResolvedContext;
  folder: string;
  homeDir: string;
  activeSourceKey: string | null;
  onOpenSource: (target: SourceTarget) => void;
}) {
  const setting = context.effective?.instructionFiles;
  if (!setting || setting.value === DEFAULT_INSTRUCTION_FILES) return null;
  const target = settingSource(setting, "setting:instructionFiles");
  return (
    <SettingRow
      setting={setting}
      value={instructionFilesValue(context)}
      folder={folder}
      homeDir={homeDir}
      active={activeSourceKey === "setting:instructionFiles"}
      onOpen={target ? () => onOpenSource(target) : undefined}
    />
  );
}
