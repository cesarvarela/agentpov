import type {
  ConfigLayer,
  HookEntry,
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
 * Instruction files: every CLAUDE.md, every `.claude/rules` file and the
 * `@imports` they pull in. Rules sit here rather than in the Memory panel —
 * they are authored instructions that load at launch (or on read, when they
 * declare `paths:`), not recalled memory.
 */
export function instructionEntries(ctx: ResolvedContext): MemoryEntry[] {
  return (
    ctx.memory.filter(
      (entry) =>
        entry.kind === "claude-md" ||
        entry.kind === "rule" ||
        entry.kind === "import",
    )
  );
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
 * Do two rules compete for the selected target? Mirrors core's `competes`: the
 * same tool, and either both hit the target or the rule text is identical (for
 * tools whose specifier is not a path).
 */
function competes(a: PermissionRule, b: PermissionRule): boolean {
  if (a.tool !== b.tool) return false;
  if (a.matchesFile && b.matchesFile) return true;
  return a.rule === b.rule;
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

/** Rules that apply to the selected file and have not been overridden. */
function liveRulesFor(ctx: ResolvedContext, tool: string): PermissionRule[] {
  return ctx.permissions.filter(
    (rule) => rule.matchesFile && !rule.overridden && rule.tool === tool,
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
 * live rule in deny → ask → allow order. Undefined when nothing matches, which
 * is the "ask" case with no rule behind it.
 */
export function winningRuleFor(
  ctx: ResolvedContext,
  tool: string,
): PermissionRule | undefined {
  const rules = liveRulesFor(ctx, tool);
  for (const decision of DECISION_STRENGTH) {
    const rule = rules.find((candidate) => candidate.decision === decision);
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
    (rule) => rule.decision === "deny" && rule.matchesFile && !rule.overridden,
  );
}

export function firstMatchingDeny(
  ctx: ResolvedContext,
): PermissionRule | undefined {
  return ctx.permissions.find(
    (rule) => rule.decision === "deny" && rule.matchesFile,
  );
}

export function firstOverridden(
  ctx: ResolvedContext,
): PermissionRule | undefined {
  return ctx.permissions.find((rule) => rule.overridden);
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
        .map((entry) => displayPath(entry.path, null, homeDir))
        .join(", "),
    });
  }

  const rules = instructions.filter((entry) => entry.kind === "rule");
  if (rules.length > 0) {
    items.push({
      title: `${rules.length} rule file${rules.length === 1 ? "" : "s"}`,
      detail: rules
        .map((entry) => relativeTo(entry.path, ctx.folder) ?? displayPath(entry.path, null, homeDir))
        .join(", "),
    });
  }

  const projectInstructions = instructions.filter(
    (entry) =>
      (entry.layer === "project" || entry.layer === "local") &&
      entry.kind === "claude-md",
  );
  const imports = instructions.filter((entry) => entry.kind === "import");
  if (projectInstructions.length > 0) {
    const importSuffix =
      imports.length > 0
        ? ` + ${imports.length} import${imports.length === 1 ? "" : "s"}`
        : "";
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
        ? `Memory index + ${files.length} memory file${files.length === 1 ? "" : "s"}`
        : `${files.length} memory file${files.length === 1 ? "" : "s"}`,
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

  if (
    ctx.skills.length > 0 ||
    ctx.agents.length > 0 ||
    ctx.mcpServers.length > 0
  ) {
    const mcpSource = ctx.mcpServers[0];
    const detail =
      ctx.mcpServers.length > 0 && mcpSource
        ? `${relativeTo(mcpSource.path, ctx.folder) ?? displayPath(mcpSource.path, null, homeDir)} → ${ctx.mcpServers
            .map((server) => server.name)
            .join(", ")}`
        : `${ctx.skills.length} skills, ${ctx.agents.length} subagents`;
    items.push({
      title: `Tool surface: ${ctx.skills.length} skills, ${ctx.agents.length} subagents, ${ctx.mcpServers.length} MCP servers`,
      detail,
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
  const lines: string[] = [
    `# Agent context for ${rel}`,
    "",
    `Folder: ${displayPath(ctx.folder, null, homeDir)}`,
    `File: ${rel}`,
    "",
    "## Instructions in context",
  ];

  const instructions = instructionEntries(ctx);
  if (instructions.length === 0) lines.push("- (none)");
  for (const entry of instructions) {
    lines.push(
      `- [${layerLabel(entry.layer)}] ${projectPath(entry.path, ctx.folder, homeDir)} — ${entry.reason}`,
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
      rule.matchesFile ? "matches this file" : null,
      rule.overridden
        ? `overridden by ${overridingDecisionFor(ctx.permissions, rule) ?? "a stronger rule"} in ${
            rule.overriddenBy
              ? `${layerLabel(rule.overriddenBy).toLowerCase()} settings`
              : "another settings file"
          }`
        : null,
    ].filter(Boolean);
    lines.push(
      `- ${rule.decision.toUpperCase()} ${rule.rule} [${layerLabel(rule.layer)}] ${projectPath(
        rule.path,
        ctx.folder,
        homeDir,
      )}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`,
    );
  }

  lines.push("", "## Hooks that fire on Edit");
  const hooks = editHooks(ctx);
  if (hooks.length === 0) lines.push("- (none)");
  for (const hook of hooks) {
    lines.push(
      `- ${hook.event}${hook.matcher ? ` (${hook.matcher})` : ""}: \`${hook.command}\` [${layerLabel(hook.layer)}]`,
    );
  }

  lines.push(
    "",
    "## Resolved verdicts",
    `- Edit(${rel}): ${verdictFor(ctx, "Edit").toUpperCase()}`,
    `- Read(${rel}): ${verdictFor(ctx, "Read").toUpperCase()}`,
    "",
    "## Tool surface",
    `- ${ctx.skills.length} skills, ${ctx.agents.length} subagents, ${ctx.mcpServers.length} MCP servers`,
  );

  if (ctx.diagnostics.length > 0) {
    lines.push("", "## Diagnostics");
    for (const diagnostic of ctx.diagnostics) lines.push(`- ${diagnostic}`);
  }

  return `${lines.join("\n")}\n`;
}
