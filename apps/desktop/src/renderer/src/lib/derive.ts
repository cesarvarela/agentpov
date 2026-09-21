import type {
  ConfigLayer,
  HookEntry,
  MemoryEntry,
  PermissionDecision,
  PermissionRule,
  ResolvedContext,
} from "@agentview/core";

import { displayPath, projectPath, relativeTo } from "./paths";

export function layerLabel(layer: ConfigLayer): string {
  return layer.charAt(0).toUpperCase() + layer.slice(1);
}

export function instructionEntries(ctx: ResolvedContext): MemoryEntry[] {
  return ctx.memory.filter(
    (entry) => entry.kind === "claude-md" || entry.kind === "import",
  );
}

export function memoryEntries(ctx: ResolvedContext): MemoryEntry[] {
  return ctx.memory.filter(
    (entry) => entry.kind === "memory-index" || entry.kind === "memory-file",
  );
}

export function editHooks(ctx: ResolvedContext): HookEntry[] {
  return ctx.hooks.filter((hook) => hook.firesOnEdit);
}

/** Rules that apply to the selected file and have not been overridden. */
function liveRulesFor(ctx: ResolvedContext, tool: string): PermissionRule[] {
  return ctx.permissions.filter(
    (rule) => rule.matchesFile && !rule.overridden && rule.tool === tool,
  );
}

/** Deny beats allow beats ask; nothing matching means the agent asks. */
export function verdictFor(
  ctx: ResolvedContext,
  tool: string,
): PermissionDecision {
  const rules = liveRulesFor(ctx, tool);
  if (rules.some((rule) => rule.decision === "deny")) return "deny";
  if (rules.some((rule) => rule.decision === "allow")) return "allow";
  return "ask";
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

  const userInstructions = instructions.filter(
    (entry) => entry.layer === "user" || entry.layer === "managed",
  );
  if (userInstructions.length > 0) {
    items.push({
      title: "System & user instructions",
      detail: userInstructions
        .map((entry) => displayPath(entry.path, null, homeDir))
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

  const directory = instructions.filter((entry) => entry.layer === "directory");
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
    lines.push({
      tone: deny ? "muted" : "primary",
      text: `Why does ${overridden.rule} behave differently than ${layerLabel(
        overridden.layer,
      )} settings say? → ${
        overridden.overriddenBy
          ? `${layerLabel(overridden.overriddenBy)} settings`
          : "a higher layer"
      } overrode the ${overridden.decision} from ${layerLabel(overridden.layer)}.`,
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
        ? `overridden by ${rule.overriddenBy ? layerLabel(rule.overriddenBy) : "a higher layer"}`
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
