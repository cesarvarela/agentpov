import type { ReactNode } from "react";
import { Badge } from "@agentpov/ui";
import type {
  AgentEntry,
  ConfigLayer,
  McpServerEntry,
  MemoryEntry,
  MemoryLoading,
  PermissionDecision,
  PermissionRule,
  SkillEntry,
  SkillSource,
  TargetKind,
} from "@agentpov/core";

import { layerLabel } from "../lib/derive";
import {
  basename,
  displayPath,
  formatBytes,
  projectPath,
  relativeTo,
} from "../lib/paths";
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

  const path = isDirectory
    ? (relativeTo(entry.path, folder) ?? entry.path)
    : projectPath(entry.path, folder, homeDir);

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
      <span className="text-om-muted shrink-0 text-[11px]">{size}</span>
    </RowButton>
  );
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

  return (
    <RowButton
      active={active}
      height="h-[30px]"
      title={rule.path}
      onClick={onOpen}
    >
      <Badge
        variant={DECISION_VARIANT[rule.decision]}
        className={`w-[46px] shrink-0 justify-center ${
          rule.overridden ? "opacity-50" : ""
        }`}
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

/**
 * Where a skill comes from, in the square layer-badge family: it is structure,
 * like USER or PROJECT, so it stays colourless.
 */
export const SKILL_SOURCE_LABEL = {
  personal: "personal",
  synced: "synced",
  project: "project",
  nested: "nested",
  plugin: "plugin",
} as const satisfies Record<SkillSource, string>;

/** Sources in the order they are listed, highest precedence first. */
export const SKILL_SOURCE_ORDER: SkillSource[] = [
  "personal",
  "synced",
  "project",
  "nested",
  "plugin",
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
  kind: "skill" | "subagent",
  shadowedBy: ConfigLayer,
  path: string,
): string {
  return `shadowed by ${shadowedBy} ${kind} at ${path}`;
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
  const shadowed = skill.shadowedBy;
  return (
    <RowButton
      active={active}
      dim={shadowed !== undefined}
      height="h-8"
      title={
        shadowed
          ? shadowTitle("skill", shadowed.layer, shadowed.path)
          : skill.path
      }
      onClick={onOpen}
    >
      <Badge className="w-[66px] shrink-0 justify-center">
        {SKILL_SOURCE_LABEL[skill.source]}
      </Badge>
      <span
        className={`w-[170px] shrink-0 truncate font-mono text-xs ${
          shadowed ? "text-om-muted line-through" : ""
        }`}
        title={skill.name}
      >
        {skill.name}
      </span>
      <span className="text-om-muted min-w-0 flex-1 truncate text-[11px]">
        {skill.description ?? projectPath(skill.path, folder, homeDir)}
      </span>
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
  const shadowed = agent.shadowedBy;
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
      dim={shadowed !== undefined}
      height={facts.length > 0 ? "min-h-[42px] py-1.5" : "h-8"}
      title={
        shadowed
          ? shadowTitle("subagent", shadowed.layer, shadowed.path)
          : agent.path
      }
      onClick={onOpen}
    >
      <Badge className="w-[66px] shrink-0 justify-center">
        {layerLabel(agent.layer)}
      </Badge>
      <span
        className={`w-[150px] shrink-0 truncate font-mono text-xs ${
          shadowed ? "text-om-muted line-through" : ""
        }`}
        title={agent.name}
      >
        {agent.name}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-om-muted truncate text-[11px]">
          {agent.description ?? projectPath(agent.path, folder, homeDir)}
        </span>
        {facts.length > 0 ? (
          <span className="text-om-muted truncate font-mono text-[11px]">
            {facts.join(" · ")}
          </span>
        ) : null}
      </span>
    </RowButton>
  );
}

/**
 * `PROJECT  fixture-http  http  https://…  env FIXTURE  DISABLED`.
 *
 * State is drawn with the badge families that already exist: a deny pill for a
 * server Claude Code would not load, a plain layer-style badge for one it would
 * have to ask about first. MCP servers have no colour of their own.
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
      dim={server.state === "disabled"}
      height="h-8"
      title={server.reason}
      onClick={onOpen}
    >
      <Badge className="w-[66px] shrink-0 justify-center">
        {layerLabel(server.layer)}
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
        {server.target ?? projectPath(server.path, folder, homeDir)}
      </span>
      {keys.length > 0 ? (
        <span
          className="text-om-muted shrink-0 truncate font-mono text-[11px]"
          title={keys.join(", ")}
        >
          {keys.join(", ")}
        </span>
      ) : null}
      {server.state === "disabled" ? (
        <Badge variant="deny" className="shrink-0">
          disabled
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
