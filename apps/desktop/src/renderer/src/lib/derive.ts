import type {
  ConfigLayer,
  EffectiveValue,
  HookEntry,
  InstructionFilesMode,
  MemoryEntry,
  PermissionDecision,
  PermissionRule,
  ResolvedContext,
} from "@agentpov/core";

import { displayPath, projectPath, relativeTo } from "./paths";

export function layerLabel(layer: ConfigLayer): string {
  return layer.charAt(0).toUpperCase() + layer.slice(1);
}

/**
 * Instruction files: every CLAUDE.md and AGENTS.md, every `.claude/rules`
 * file, the `@imports` they pull in, and the managed `claudeMd` text. Rules sit
 * here rather than in the Memory panel — they are authored instructions that
 * load at launch (or on read, when they declare `paths:`), not recalled memory.
 */
export function instructionEntries(ctx: ResolvedContext): MemoryEntry[] {
  return ctx.memory.filter(
    (entry) =>
      entry.kind === "claude-md" ||
      entry.kind === "agents-md" ||
      entry.kind === "inline" ||
      entry.kind === "rule" ||
      entry.kind === "import",
  );
}

/**
 * Instruction files counted as files in panel notes: CLAUDE.md, AGENTS.md,
 * rules and the managed `claudeMd` text. Imports are counted inside the file
 * that pulls them in.
 */
export function isInstructionFile(entry: MemoryEntry): boolean {
  return (
    entry.kind === "claude-md" ||
    entry.kind === "agents-md" ||
    entry.kind === "inline" ||
    entry.kind === "rule"
  );
}

/** Claude Code's default for `instructionFiles`. */
export const DEFAULT_INSTRUCTION_FILES: InstructionFilesMode =
  "claude-md-or-agents-md";

/** What each `instructionFiles` mode means, in a few words. */
export const INSTRUCTION_FILES_LABEL: Record<InstructionFilesMode, string> = {
  "claude-md-or-agents-md": "CLAUDE.md, else AGENTS.md",
  "claude-md-and-agents-md": "CLAUDE.md and AGENTS.md",
  "claude-md": "CLAUDE.md only, AGENTS.md ignored",
  "managed-only": "managed instructions only",
};

/** The empty-state line for the Instructions panel, worded for the mode. */
export function noInstructionsText(
  ctx: ResolvedContext | null,
  target: "file" | "folder",
): string {
  const mode = ctx?.effective?.instructionFiles.value ?? DEFAULT_INSTRUCTION_FILES;
  const files =
    mode === "claude-md"
      ? "CLAUDE.md"
      : mode === "managed-only"
        ? "managed instruction"
        : "CLAUDE.md or AGENTS.md";
  return `No ${files} applies to this ${target}.`;
}

/** Just the `.claude/rules` files, in precedence order. */
export function ruleEntries(ctx: ResolvedContext): MemoryEntry[] {
  return ctx.memory.filter((entry) => entry.kind === "rule");
}

export function memoryEntries(ctx: ResolvedContext): MemoryEntry[] {
  return ctx.memory.filter(
    (entry) => entry.kind === "memory-index" || entry.kind === "memory-file",
  );
}

export function editHooks(ctx: ResolvedContext): HookEntry[] {
  return ctx.hooks.filter((hook) => hook.firesOnEdit);
}

/** Instruction entries split into "this folder owns them" and "inherited". */
export interface FolderMemorySplit {
  /** CLAUDE.md files living at or under the selected folder. */
  own: MemoryEntry[];
  /** Everything the folder inherits: user/project layers and ancestor dirs. */
  inherited: MemoryEntry[];
}

/**
 * Splits `memory` for a folder view. An entry is folder-owned when it is a
 * `directory`-layer file (a CLAUDE.md picked up because of where the target
 * sits) that lives at or under `folder`. A directory CLAUDE.md between the
 * project root and `folder` is an ancestor's, so it counts as inherited.
 *
 * The test is the layer, so it holds for `.claude/rules` files too: a project-
 * layer rule loads for the whole project and is inherited here, however
 * narrowly its `paths:` globs happen to point at this folder.
 *
 * @param memory entries from the resolved context, in precedence order.
 * @param folder absolute path of the selected folder.
 */
export function splitFolderMemory(
  memory: MemoryEntry[],
  folder: string,
): FolderMemorySplit {
  const own: MemoryEntry[] = [];
  const inherited: MemoryEntry[] = [];
  for (const entry of memory) {
    const isOwn =
      entry.layer === "directory" && relativeTo(entry.path, folder) !== null;
    (isOwn ? own : inherited).push(entry);
  }
  return { own, inherited };
}

/**
 * Turns a rule specifier into a project-root-relative path, following the same
 * conventions as core's permission resolver: `//abs` is absolute, `~/x` is
 * home-relative, a single leading `/` is project-root relative, and `./x` and
 * bare `x` are relative to the root too. Returns null when the specifier
 * resolves outside the project.
 */
function specifierProjectPath(
  specifier: string,
  root: string,
  homeDir: string,
): string | null {
  const raw = specifier.trim();
  if (raw.length === 0) return null;
  if (raw.startsWith("//")) return relativeTo(raw.slice(1), root);
  if (raw.startsWith("~/")) {
    return relativeTo(`${homeDir}/${raw.slice(2)}`, root);
  }
  if (raw.startsWith("/")) return raw.replace(/^\/+/, "");
  return raw.replace(/^\.\//, "");
}

/** Leading segments of a glob before the first one holding a wildcard. */
function literalPrefix(pattern: string): string {
  const segments = pattern.replace(/\/+$/, "").split("/");
  const literal: string[] = [];
  for (const segment of segments) {
    if (/[*?]/.test(segment)) break;
    literal.push(segment);
  }
  return literal.join("/");
}

/**
 * Does this rule aim at `folder` rather than at the whole project?
 *
 * The specifier is resolved to a project-relative path (see
 * `specifierProjectPath`) and reduced to its wildcard-free leading segments.
 * The rule targets the folder when those literal segments are the folder's own
 * project-relative path or sit inside it — or when the specifier is exactly
 * the folder path. A rule with no specifier, or one whose pattern starts with
 * a wildcard (`**\/*.ts`), has an empty literal prefix: it covers the project
 * root too, so it is inherited, not folder-specific.
 *
 * @param rule candidate rule; callers pass ones that already `matchesFile`.
 * @param root absolute project root.
 * @param folder absolute path of the selected folder (never the root).
 * @param homeDir absolute home directory, for `~/` specifiers.
 */
export function ruleTargetsFolder(
  rule: PermissionRule,
  root: string,
  folder: string,
  homeDir: string,
): boolean {
  if (!rule.specifier) return false;

  const folderPath = relativeTo(folder, root);
  // The root itself (`""`) is never "folder-specific", nor is a folder outside
  // the project.
  if (folderPath === null || folderPath === "") return false;

  const target = specifierProjectPath(rule.specifier, root, homeDir);
  if (target === null) return false;

  const cleanTarget = target.replace(/\/+$/, "");
  if (cleanTarget === folderPath) return true;

  const literal = literalPrefix(cleanTarget);
  if (literal === "") return false;
  return literal === folderPath || literal.startsWith(`${folderPath}/`);
}

/** Strongest first: the merged rule set is evaluated in this order. */
const DECISION_STRENGTH: PermissionDecision[] = ["deny", "ask", "allow"];

/**
 * Tools a matching `Read(path)` deny also blocks (docs: /permissions, "Read
 * and Edit"). Mirrors core's `BLOCKED_BY_READ_DENY`.
 */
const BLOCKED_BY_READ_DENY = new Set(["Edit", "Write"]);

/** A `Read(path)` deny that hits the target, so it blocks edits there too. */
function isPathReadDeny(rule: PermissionRule): boolean {
  return (
    rule.tool === "Read" &&
    rule.decision === "deny" &&
    rule.specifier !== undefined &&
    rule.matchesFile
  );
}

/**
 * Do two rules compete for the selected target? Mirrors core's `competes`: the
 * same tool, and either both hit the target or the rule text is identical (for
 * tools whose specifier is not a path); across tools, a `Read(path)` deny that
 * hits the target competes with an Edit/Write rule that hits it too.
 */
function competes(a: PermissionRule, b: PermissionRule): boolean {
  if (a.ignored || b.ignored) return false;
  if (a.tool !== b.tool) {
    return (
      isPathReadDeny(b) && BLOCKED_BY_READ_DENY.has(a.tool) && a.matchesFile
    );
  }
  if (a.matchesFile && b.matchesFile) return true;
  return a.rule === b.rule && !a.carvedOutBy && !b.carvedOutBy;
}

/**
 * The decision that overrode `rule`, for the row's annotation. Core records
 * only the winner's layer in `overriddenBy`, so the decision is recovered the
 * same way core picked it: the strongest decision among the competing rules.
 * Undefined when the rule was not overridden.
 */
export function overridingDecisionFor(
  rules: PermissionRule[],
  rule: PermissionRule,
): PermissionDecision | undefined {
  if (!rule.overridden) return undefined;
  const mine = DECISION_STRENGTH.indexOf(rule.decision);
  return DECISION_STRENGTH.find(
    (decision) =>
      DECISION_STRENGTH.indexOf(decision) < mine &&
      rules.some(
        (other) =>
          other !== rule && other.decision === decision && competes(rule, other),
      ),
  );
}

/**
 * A rule Claude Code actually evaluates: not dropped outright (`ignored`, e.g.
 * a non-managed rule under `allowManagedPermissionRulesOnly`).
 */
export function isLiveRule(rule: PermissionRule): boolean {
  return !rule.ignored;
}

/**
 * Does `rule` take part in deciding a `tool` call on the target?
 *
 * - its own tool, always;
 * - for Write, `Edit(path)` rules too: Claude Code checks file paths against
 *   Edit and Read rules only (a `Write(path)` rule is `ignored`), and Edit
 *   rules cover every built-in tool that edits files;
 * - for Edit and Write, a `Read(path)` deny that hits the target, which blocks
 *   edits on the same path.
 */
function decides(rule: PermissionRule, tool: string): boolean {
  if (rule.tool === tool) return true;
  if (tool === "Write" && rule.tool === "Edit") return true;
  return BLOCKED_BY_READ_DENY.has(tool) && isPathReadDeny(rule);
}

/**
 * Rules Claude Code evaluates for a `tool` call on the selected file: live
 * (not `ignored`), hitting the target, and relevant to the tool. Overridden
 * rules can stay in: the strongest decision wins either way.
 */
function liveRulesFor(ctx: ResolvedContext, tool: string): PermissionRule[] {
  return ctx.permissions.filter(
    (rule) => isLiveRule(rule) && rule.matchesFile && decides(rule, tool),
  );
}

/**
 * Deny beats ask beats allow — the order the merged rule set is evaluated in.
 * Nothing matching means the agent asks.
 */
export function verdictFor(
  ctx: ResolvedContext,
  tool: string,
): PermissionDecision {
  const rules = liveRulesFor(ctx, tool);
  for (const decision of DECISION_STRENGTH) {
    if (rules.some((rule) => rule.decision === decision)) return decision;
  }
  return "ask";
}

/**
 * The rule that decides the verdict for `tool` on the selected file: the first
 * live rule in deny → ask → allow order, preferring one written for the tool
 * itself over one that reaches it from another tool. Undefined when nothing
 * matches, which is the "ask" case with no rule behind it.
 */
export function winningRuleFor(
  ctx: ResolvedContext,
  tool: string,
): PermissionRule | undefined {
  const rules = liveRulesFor(ctx, tool);
  for (const decision of DECISION_STRENGTH) {
    const candidates = rules.filter((candidate) => candidate.decision === decision);
    const rule =
      candidates.find((candidate) => candidate.tool === tool) ?? candidates[0];
    if (rule) return rule;
  }
  return undefined;
}

/**
 * Every deny rule that still applies to the selected file: it matches the file
 * (or, once import tracking lands, something the file imports) and no higher
 * layer overrode it. These become the red chips in the header row.
 */
export function matchingDenyRules(ctx: ResolvedContext): PermissionRule[] {
  return ctx.permissions.filter(
    (rule) =>
      isLiveRule(rule) &&
      rule.decision === "deny" &&
      rule.matchesFile &&
      !rule.overridden,
  );
}

export function firstMatchingDeny(
  ctx: ResolvedContext,
): PermissionRule | undefined {
  return ctx.permissions.find(
    (rule) => isLiveRule(rule) && rule.decision === "deny" && rule.matchesFile,
  );
}

export function firstOverridden(
  ctx: ResolvedContext,
): PermissionRule | undefined {
  return ctx.permissions.find((rule) => isLiveRule(rule) && rule.overridden);
}

/** `3 skills` / `1 skill`. */
export function plural(total: number, noun: string): string {
  return `${total} ${noun}${total === 1 ? "" : "s"}`;
}

/**
 * How an instruction entry is named in text: its path, except the managed
 * `claudeMd` text, which has no file of its own and is named by its setting.
 */
export function instructionLabel(
  entry: MemoryEntry,
  folder: string,
  homeDir: string,
): string {
  if (entry.kind === "inline") {
    return `claudeMd in ${displayPath(entry.path, null, homeDir)}`;
  }
  return projectPath(entry.path, folder, homeDir);
}

/**
 * What an enabled plugin brings into the session, counted from the entries
 * that name it in their `plugin` field.
 */
export interface PluginContributions {
  skills: number;
  agents: number;
  hooks: number;
  mcpServers: number;
  outputStyles: number;
  workflows: number;
}

export function pluginContributions(
  ctx: ResolvedContext,
  plugin: string,
): PluginContributions {
  const mine = (entry: { plugin?: string }) => entry.plugin === plugin;
  return {
    skills: ctx.skills.filter(mine).length,
    agents: ctx.agents.filter(mine).length,
    hooks: ctx.hooks.filter(mine).length,
    mcpServers: ctx.mcpServers.filter(mine).length,
    outputStyles: (ctx.outputStyles ?? []).filter(mine).length,
    workflows: (ctx.workflows ?? []).filter(mine).length,
  };
}

/** `2 skills · 1 subagent · 3 hooks`, or null when it brings nothing. */
export function contributionSummary(c: PluginContributions): string | null {
  const parts = [
    c.skills > 0 ? plural(c.skills, "skill") : null,
    c.agents > 0 ? plural(c.agents, "subagent") : null,
    c.hooks > 0 ? plural(c.hooks, "hook") : null,
    c.mcpServers > 0 ? `${c.mcpServers} MCP` : null,
    c.outputStyles > 0 ? plural(c.outputStyles, "output style") : null,
    c.workflows > 0 ? plural(c.workflows, "workflow") : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** On disk but out of play: shadowed by a same-named entry, or turned off. */
export function isOff(entry: {
  shadowedBy?: unknown;
  disabled?: string;
}): boolean {
  return entry.shadowedBy !== undefined || entry.disabled !== undefined;
}

/** An MCP server Claude Code will not start: disabled or blocked by policy. */
export function isMcpOff(server: { state: string }): boolean {
  return server.state === "disabled" || server.state === "blocked";
}

/**
 * When a hook is registered, for the ones that aren't always on. Core's `note`
 * wins; otherwise it is worded from the hook's source.
 */
export function hookScope(hook: HookEntry): string | null {
  if (hook.note) return hook.note;
  if (hook.source === "skill" && hook.owner) {
    return `while skill ${hook.owner} is running`;
  }
  if (hook.source === "agent" && hook.owner) {
    return `while subagent ${hook.owner} runs`;
  }
  return null;
}

/** `settings` hooks read as their layer; the others by what declares them. */
export function hookOrigin(hook: HookEntry): string {
  switch (hook.source) {
    case "plugin":
      return hook.plugin ? `plugin ${hook.plugin}` : "plugin";
    case "skill":
      return hook.owner ? `skill ${hook.owner}` : "skill";
    case "agent":
      return hook.owner ? `subagent ${hook.owner}` : "subagent";
    default:
      return `${layerLabel(hook.layer)} settings`;
  }
}

/**
 * One chip in the session settings row: a session-wide switch that changes
 * what the panels mean. Only non-default values get one, except the
 * permission mode, which every verdict depends on.
 */
export interface SessionSetting {
  id: string;
  label: string;
  value: string;
  setting: EffectiveValue<unknown>;
}

function isDefaultStyle(name: string): boolean {
  return name.toLowerCase() === "default";
}

export function sessionSettings(ctx: ResolvedContext): SessionSetting[] {
  const effective = ctx.effective;
  if (!effective) return [];
  const out: SessionSetting[] = [
    {
      id: "permissionMode",
      label: "mode",
      value: effective.permissionMode.value,
      setting: effective.permissionMode,
    },
  ];
  if (!isDefaultStyle(effective.outputStyle.value)) {
    out.push({
      id: "outputStyle",
      label: "output style",
      value: effective.outputStyle.value,
      setting: effective.outputStyle,
    });
  }
  if (effective.instructionFiles.value !== DEFAULT_INSTRUCTION_FILES) {
    out.push({
      id: "instructionFiles",
      label: "instructions",
      value: INSTRUCTION_FILES_LABEL[effective.instructionFiles.value],
      setting: effective.instructionFiles,
    });
  }
  if (!effective.autoMemory.value) {
    out.push({
      id: "autoMemory",
      label: "auto memory",
      value: "off",
      setting: effective.autoMemory,
    });
  }
  if (effective.disableAllHooks.value) {
    out.push({
      id: "disableAllHooks",
      label: "hooks",
      value: "all disabled",
      setting: effective.disableAllHooks,
    });
  } else if (effective.allowManagedHooksOnly.value) {
    out.push({
      id: "allowManagedHooksOnly",
      label: "hooks",
      value: "managed only",
      setting: effective.allowManagedHooksOnly,
    });
  }
  if (!effective.workflows.value) {
    out.push({
      id: "workflows",
      label: "workflows",
      value: "off",
      setting: effective.workflows,
    });
  }
  return out;
}

/** Last segment of a settings key path: `permissions.defaultMode` → `defaultMode`. */
export function settingKeyName(key: string): string {
  const match = key.match(/([^.[\]"]+)["\]]*$/);
  return match?.[1] ?? key;
}

/** `from ~/.claude/settings.json · note`, for tooltips and the export. */
export function settingProvenance(
  setting: EffectiveValue<unknown>,
  folder: string,
  homeDir: string,
): string {
  const where = setting.source
    ? `${setting.key} in ${projectPath(setting.source.path, folder, homeDir)}`
    : `${setting.key} not set, default`;
  return setting.note ? `${where} · ${setting.note}` : where;
}

export interface EffectiveItem {
  title: string;
  detail: string;
}

/** The numbered "what the agent receives, in order" list of the right rail. */
export function effectiveItems(
  ctx: ResolvedContext,
  homeDir: string,
): EffectiveItem[] {
  const items: EffectiveItem[] = [];
  const instructions = instructionEntries(ctx);

  // Rules get their own line below, whatever layer they came from.
  const userInstructions = instructions.filter(
    (entry) =>
      entry.kind !== "rule" &&
      (entry.layer === "user" || entry.layer === "managed"),
  );
  if (userInstructions.length > 0) {
    items.push({
      title: "System & user instructions",
      detail: userInstructions
        .map((entry) =>
          entry.kind === "inline"
            ? instructionLabel(entry, ctx.folder, homeDir)
            : displayPath(entry.path, null, homeDir),
        )
        .join(", "),
    });
  }

  const rules = instructions.filter((entry) => entry.kind === "rule");
  if (rules.length > 0) {
    items.push({
      title: plural(rules.length, "rule file"),
      detail: rules
        .map((entry) => relativeTo(entry.path, ctx.folder) ?? displayPath(entry.path, null, homeDir))
        .join(", "),
    });
  }

  const projectInstructions = instructions.filter(
    (entry) =>
      (entry.layer === "project" || entry.layer === "local") &&
      (entry.kind === "claude-md" || entry.kind === "agents-md"),
  );
  const imports = instructions.filter((entry) => entry.kind === "import");
  if (projectInstructions.length > 0) {
    const importSuffix =
      imports.length > 0 ? ` + ${plural(imports.length, "import")}` : "";
    items.push({
      title: `Project instructions${importSuffix}`,
      detail: projectInstructions
        .map((entry) => relativeTo(entry.path, ctx.folder) ?? entry.path)
        .join(", "),
    });
  }

  const memory = memoryEntries(ctx);
  if (memory.length > 0) {
    const index = memory.find((entry) => entry.kind === "memory-index");
    const files = memory.filter((entry) => entry.kind === "memory-file");
    items.push({
      title: index
        ? `Memory index + ${plural(files.length, "memory file")}`
        : plural(files.length, "memory file"),
      detail: displayPath(
        (index ?? files[0])?.path ?? "",
        null,
        homeDir,
      ),
    });
  }

  // Not "directory-layer files" but "files Claude Code only pulls in when it
  // reads something under them" — the loading mode says so directly.
  const directory = instructions.filter(
    (entry) => entry.loading === "on-read" && entry.kind !== "rule",
  );
  if (directory.length > 0) {
    items.push({
      title: "Directory instructions, on read",
      detail: directory
        .map((entry) => relativeTo(entry.path, ctx.folder) ?? entry.path)
        .join(", "),
    });
  }

  const style = (ctx.outputStyles ?? []).find((entry) => entry.active);
  if (style) {
    items.push({
      title: `Output style: ${style.name}`,
      detail: projectPath(style.path, ctx.folder, homeDir),
    });
  }

  // Only what is actually in play counts; the rest is named as "off".
  const skills = ctx.skills.filter((skill) => !isOff(skill));
  const agents = ctx.agents.filter((agent) => !isOff(agent));
  const servers = ctx.mcpServers.filter((server) => !isMcpOff(server));
  const off =
    ctx.skills.length -
    skills.length +
    (ctx.agents.length - agents.length) +
    (ctx.mcpServers.length - servers.length);
  if (
    ctx.skills.length > 0 ||
    ctx.agents.length > 0 ||
    ctx.mcpServers.length > 0
  ) {
    const offSuffix = off > 0 ? ` (${off} more shadowed, disabled or blocked)` : "";
    items.push({
      title: `Tool surface: ${plural(skills.length, "skill")}, ${plural(agents.length, "subagent")}, ${plural(servers.length, "MCP server")}${offSuffix}`,
      detail:
        servers.length > 0
          ? servers.map((server) => server.name).join(", ")
          : `${plural(skills.length, "skill")}, ${plural(agents.length, "subagent")}`,
    });
  }

  const plugins = (ctx.plugins ?? []).filter((plugin) => plugin.enabled);
  if (plugins.length > 0) {
    items.push({
      title: plural(plugins.length, "plugin"),
      detail: plugins.map((plugin) => plugin.id).join(", "),
    });
  }

  return items;
}

export interface ExplainLine {
  text: string;
  tone: "primary" | "muted";
}

/** Auto-generated "why" sentences for the Explain box. */
export function explainLines(
  ctx: ResolvedContext,
  homeDir: string,
): ExplainLine[] {
  const lines: ExplainLine[] = [];

  const deny = firstMatchingDeny(ctx);
  if (deny) {
    lines.push({
      tone: "primary",
      text: `Why is this blocked? → a deny rule ${deny.rule} in ${projectPath(
        deny.path,
        ctx.folder,
        homeDir,
      )}. Deny wins at every level, so any allow for the same target has no effect.`,
    });
  }

  const overridden = firstOverridden(ctx);
  if (overridden) {
    const stronger = overridingDecisionFor(ctx.permissions, overridden);
    lines.push({
      tone: deny ? "muted" : "primary",
      text: `Why does ${overridden.rule} behave differently than ${layerLabel(
        overridden.layer,
      )} settings say? → Claude Code merges every layer into one rule set and reads it deny → ask → allow, so the ${
        stronger ?? "stronger"
      } in ${
        overridden.overriddenBy
          ? `${layerLabel(overridden.overriddenBy).toLowerCase()} settings`
          : "another settings file"
      } wins over this ${overridden.decision}.`,
    });
  }

  return lines;
}


/** Markdown blob for the "Copy as context" button. */
export function contextMarkdown(
  ctx: ResolvedContext,
  homeDir: string,
): string {
  const rel = relativeTo(ctx.file, ctx.folder) ?? ctx.file;
  const where = (path: string) => projectPath(path, ctx.folder, homeDir);
  const lines: string[] = [
    `# Agent context for ${rel}`,
    "",
    `Folder: ${displayPath(ctx.folder, null, homeDir)}`,
    `File: ${rel}`,
  ];

  const session = sessionSettings(ctx);
  if (session.length > 0) {
    lines.push("", "## Session");
    for (const item of session) {
      lines.push(
        `- ${item.label}: ${item.value} (${settingProvenance(item.setting, ctx.folder, homeDir)})`,
      );
    }
  }

  lines.push("", "## Instructions in context");
  const instructions = instructionEntries(ctx);
  if (instructions.length === 0) lines.push("- (none)");
  for (const entry of instructions) {
    lines.push(
      `- [${layerLabel(entry.layer)}] ${instructionLabel(entry, ctx.folder, homeDir)} — ${entry.reason}`,
    );
  }

  lines.push("", "## Memory");
  const memory = memoryEntries(ctx);
  if (memory.length === 0) lines.push("- (none)");
  for (const entry of memory) {
    lines.push(
      `- [${layerLabel(entry.layer)}] ${displayPath(entry.path, ctx.folder, homeDir)} — ${entry.reason}`,
    );
  }

  lines.push("", "## Permissions affecting this file");
  if (ctx.permissions.length === 0) lines.push("- (none)");
  for (const rule of ctx.permissions) {
    const notes = [
      rule.ignored ? `ignored: ${rule.ignored}` : null,
      rule.matchesFile ? "matches this file" : null,
      rule.overridden && !rule.ignored
        ? `overridden by ${overridingDecisionFor(ctx.permissions, rule) ?? "a stronger rule"} in ${
            rule.overriddenBy
              ? `${layerLabel(rule.overriddenBy).toLowerCase()} settings`
              : "another settings file"
          }`
        : null,
    ].filter(Boolean);
    lines.push(
      `- ${rule.decision.toUpperCase()} ${rule.rule} [${layerLabel(rule.layer)}] ${where(rule.path)}${
        notes.length > 0 ? ` (${notes.join("; ")})` : ""
      }`,
    );
  }

  lines.push("", "## Hooks that fire on Edit");
  const hooks = editHooks(ctx);
  if (hooks.length === 0) lines.push("- (none)");
  for (const hook of hooks) {
    const notes = [
      hookOrigin(hook),
      hookScope(hook),
      hook.disabled ? `disabled: ${hook.disabled}` : null,
    ].filter(Boolean);
    lines.push(
      `- ${hook.event}${hook.matcher ? ` (${hook.matcher})` : ""}: \`${hook.command}\` [${notes.join("; ")}]`,
    );
  }

  lines.push(
    "",
    "## Resolved verdicts",
    `- Edit(${rel}): ${verdictFor(ctx, "Edit").toUpperCase()}`,
    `- Read(${rel}): ${verdictFor(ctx, "Read").toUpperCase()}`,
    `- Write(${rel}): ${verdictFor(ctx, "Write").toUpperCase()}`,
  );

  const sandbox = ctx.sandbox;
  if (sandbox?.enabled.value) {
    lines.push("", "## Bash sandbox (Bash commands only)");
    if (sandbox.target) {
      lines.push(
        `- Bash read of ${rel}: ${sandbox.target.read.toUpperCase()}`,
        `- Bash write to ${rel}: ${sandbox.target.write.toUpperCase()}`,
        `- ${sandbox.target.reason}`,
      );
    }
    for (const rule of sandbox.filesystem.filter((entry) => entry.matchesTarget)) {
      lines.push(
        `- ${rule.kind} ${rule.pattern} [${layerLabel(rule.layer)}] ${where(rule.path)}${
          rule.fromPermission ? ` (from ${rule.fromPermission})` : ""
        }`,
      );
    }
  }

  const plugins = ctx.plugins ?? [];
  if (plugins.length > 0) {
    lines.push("", "## Plugins");
    for (const plugin of plugins) {
      const brings = contributionSummary(pluginContributions(ctx, plugin.name));
      lines.push(
        `- ${plugin.enabled ? "ON" : "OFF"} ${plugin.id}${plugin.version ? ` ${plugin.version}` : ""} — ${plugin.reason}${
          plugin.enabled && brings ? ` (${brings})` : ""
        }`,
      );
    }
  }

  const liveSkills = ctx.skills.filter((skill) => !isOff(skill)).length;
  const liveAgents = ctx.agents.filter((agent) => !isOff(agent)).length;
  lines.push(
    "",
    "## Tool surface",
    `- ${plural(liveSkills, "skill")}, ${plural(liveAgents, "subagent")}, ${plural(
      ctx.mcpServers.filter((server) => !isMcpOff(server)).length,
      "MCP server",
    )}`,
  );
  for (const server of ctx.mcpServers.filter(isMcpOff)) {
    lines.push(`- MCP ${server.name} ${server.state}: ${server.reason}`);
  }
  const style = (ctx.outputStyles ?? []).find((entry) => entry.active);
  const styleName = style?.name ?? ctx.effective?.outputStyle.value;
  if (styleName && !isDefaultStyle(styleName)) {
    lines.push(`- output style: ${styleName}`);
  }
  const workflows = (ctx.workflows ?? []).filter((entry) => !isOff(entry));
  if (workflows.length > 0) {
    lines.push(`- ${plural(workflows.length, "workflow")}: ${workflows.map((entry) => entry.name).join(", ")}`);
  }

  if (ctx.diagnostics.length > 0) {
    lines.push("", "## Diagnostics");
    for (const diagnostic of ctx.diagnostics) lines.push(`- ${diagnostic}`);
  }

  return `${lines.join("\n")}\n`;
}
