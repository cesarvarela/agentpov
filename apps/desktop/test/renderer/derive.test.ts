import { describe, expect, it } from "vitest";
import type {
  EffectiveSettings,
  MemoryEntry,
  PermissionRule,
  ResolvedContext,
} from "@agentpov/core";

import {
  contextMarkdown,
  effectiveItems,
  hookScope,
  instructionEntries,
  matchingDenyRules,
  noInstructionsText,
  overridingDecisionFor,
  pluginContributions,
  sessionSettings,
  verdictFor,
  winningRuleFor,
} from "../../src/renderer/src/lib/derive";

const HOME = "/Users/me";
const FOLDER = "/Users/me/app";
const SETTINGS = `${FOLDER}/.claude/settings.json`;

function effective(overrides: Partial<EffectiveSettings> = {}): EffectiveSettings {
  return {
    permissionMode: { value: "default", key: "permissions.defaultMode" },
    outputStyle: { value: "Default", key: "outputStyle" },
    instructionFiles: {
      value: "claude-md-or-agents-md",
      key: 'pluginConfigs["agents-md@builtin"].options.instructionFiles',
    },
    autoMemory: { value: true, key: "autoMemoryEnabled" },
    disableAllHooks: { value: false, key: "disableAllHooks" },
    allowManagedHooksOnly: { value: false, key: "allowManagedHooksOnly" },
    workflows: { value: true, key: "disableWorkflows" },
    ...overrides,
  };
}

function context(overrides: Partial<ResolvedContext> = {}): ResolvedContext {
  const off = { value: false, key: "sandbox.enabled" };
  return {
    folder: FOLDER,
    file: `${FOLDER}/src/a.ts`,
    targetKind: "file",
    memory: [],
    settings: [],
    permissions: [],
    hooks: [],
    skills: [],
    agents: [],
    mcpServers: [],
    plugins: [],
    outputStyles: [],
    workflows: [],
    sandbox: {
      enabled: off,
      autoAllowBashIfSandboxed: off,
      allowUnsandboxedCommands: off,
      filesystemDisabled: off,
      excludedCommands: [],
      filesystem: [],
      allowedDomains: [],
      deniedDomains: [],
      target: null,
    },
    effective: effective(),
    diagnostics: [],
    ...overrides,
  };
}

function rule(text: string, decision: PermissionRule["decision"], extra: Partial<PermissionRule> = {}): PermissionRule {
  const match = /^([^(]+)(?:\((.*)\))?$/.exec(text)!;
  return {
    path: SETTINGS,
    layer: "project",
    rule: text,
    tool: match[1]!,
    ...(match[2] ? { specifier: match[2] } : {}),
    decision,
    matchesFile: true,
    overridden: false,
    ...extra,
  };
}

function memory(kind: MemoryEntry["kind"], path: string, extra: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    path,
    layer: "project",
    kind,
    reason: "always loaded",
    loading: "always",
    scopedToFile: false,
    ...extra,
  };
}

describe("instructionEntries", () => {
  it("includes AGENTS.md and the managed claudeMd text, not memory", () => {
    const ctx = context({
      memory: [
        memory("inline", "/Library/managed-settings.json", { layer: "managed" }),
        memory("agents-md", `${FOLDER}/AGENTS.md`),
        memory("memory-index", `${HOME}/.claude/projects/x/memory/MEMORY.md`, { layer: "user" }),
      ],
    });
    expect(instructionEntries(ctx).map((entry) => entry.kind)).toEqual([
      "inline",
      "agents-md",
    ]);
  });

  it("names AGENTS.md in the empty state unless the mode ignores it", () => {
    expect(noInstructionsText(context(), "file")).toBe(
      "No CLAUDE.md or AGENTS.md applies to this file.",
    );
    const claudeOnly = context({
      effective: effective({
        instructionFiles: { value: "claude-md", key: "instructionFiles" },
      }),
    });
    expect(noInstructionsText(claudeOnly, "folder")).toBe(
      "No CLAUDE.md applies to this folder.",
    );
  });
});

describe("verdicts", () => {
  it("skips ignored rules", () => {
    const ctx = context({
      permissions: [
        rule("Edit(src/**)", "deny", { ignored: "allowManagedPermissionRulesOnly" }),
        rule("Edit(src/**)", "allow", { layer: "managed" }),
      ],
    });
    expect(verdictFor(ctx, "Edit")).toBe("allow");
    expect(winningRuleFor(ctx, "Edit")?.layer).toBe("managed");
    expect(matchingDenyRules(ctx)).toEqual([]);
  });

  it("lets a Read(path) deny block Edit and Write on the same path", () => {
    const allow = rule("Edit(src/**)", "allow", {
      overridden: true,
      overriddenBy: "user",
    });
    const deny = rule("Read(src/a.ts)", "deny", { layer: "user" });
    const ctx = context({ permissions: [allow, deny] });
    expect(verdictFor(ctx, "Edit")).toBe("deny");
    expect(verdictFor(ctx, "Write")).toBe("deny");
    expect(winningRuleFor(ctx, "Edit")).toBe(deny);
    expect(overridingDecisionFor(ctx.permissions, allow)).toBe("deny");
  });

  it("decides Write from Edit(path) rules, since Write(path) rules are ignored", () => {
    const ctx = context({
      permissions: [
        rule("Write(src/**)", "deny", { ignored: "Write(path) rules are never consulted" }),
        rule("Edit(src/**)", "allow"),
      ],
    });
    expect(verdictFor(ctx, "Write")).toBe("allow");
    expect(verdictFor(ctx, "Read")).toBe("ask");
  });
});

describe("plugins and session", () => {
  it("counts what a plugin contributes by its name", () => {
    const base = { path: "/p", layer: "user" as const };
    const ctx = context({
      skills: [
        { ...base, name: "tools:a", shortName: "a", source: "plugin", plugin: "tools" },
        { ...base, name: "b", shortName: "b", source: "personal" },
      ],
      hooks: [
        { ...base, event: "PreToolUse", command: "x", firesOnEdit: true, source: "plugin", plugin: "tools" },
      ],
      mcpServers: [
        { ...base, name: "plugin:tools:db", transport: "stdio", state: "enabled", reason: "", plugin: "tools" },
      ],
    });
    expect(pluginContributions(ctx, "tools")).toEqual({
      skills: 1,
      agents: 0,
      hooks: 1,
      mcpServers: 1,
      outputStyles: 0,
      workflows: 0,
    });
  });

  it("lists the mode always and other switches only when not default", () => {
    expect(sessionSettings(context()).map((item) => item.id)).toEqual(["permissionMode"]);
    const ctx = context({
      effective: effective({
        disableAllHooks: { value: true, key: "disableAllHooks" },
        autoMemory: { value: false, key: "autoMemoryEnabled" },
        outputStyle: { value: "terse", key: "outputStyle" },
      }),
    });
    expect(sessionSettings(ctx).map((item) => `${item.label}=${item.value}`)).toEqual([
      "mode=default",
      "output style=terse",
      "auto memory=off",
      "hooks=all disabled",
    ]);
  });

  it("words when a skill's or subagent's hook is registered", () => {
    const base = { path: "/p", layer: "project" as const, event: "Stop", command: "x", firesOnEdit: false };
    expect(hookScope({ ...base, source: "skill", owner: "deploy" })).toBe(
      "while skill deploy is running",
    );
    expect(hookScope({ ...base, source: "agent", owner: "rev", note: "as SubagentStop" })).toBe(
      "as SubagentStop",
    );
    expect(hookScope(base)).toBeNull();
  });
});

describe("summaries", () => {
  it("leaves out-of-play entries off the tool surface count", () => {
    const base = { path: "/p", layer: "project" as const };
    const ctx = context({
      skills: [
        { ...base, name: "a", shortName: "a", source: "project" },
        { ...base, name: "b", shortName: "b", source: "project", disabled: "skillOverrides" },
      ],
      mcpServers: [
        { ...base, name: "db", transport: "stdio", state: "blocked", reason: "deniedMcpServers" },
      ],
    });
    const surface = effectiveItems(ctx, HOME).find((item) =>
      item.title.startsWith("Tool surface"),
    );
    expect(surface?.title).toBe(
      "Tool surface: 1 skill, 0 subagents, 0 MCP servers (2 more shadowed, disabled or blocked)",
    );
  });

  it("exports plugins, ignored rules and blocked servers", () => {
    const ctx = context({
      permissions: [rule("Write(src/**)", "deny", { ignored: "never consulted" })],
      plugins: [
        {
          path: "/c/plugins/installed_plugins.json",
          layer: "user",
          id: "tools@market",
          name: "tools",
          origin: "marketplace",
          enabled: false,
          reason: "disabled by enabledPlugins",
        },
      ],
      mcpServers: [
        { path: "/p", layer: "managed", name: "db", transport: "stdio", state: "blocked", reason: "deniedMcpServers" },
      ],
    });
    const markdown = contextMarkdown(ctx, HOME);
    expect(markdown).toContain("(ignored: never consulted; matches this file)");
    expect(markdown).toContain("- OFF tools@market — disabled by enabledPlugins");
    expect(markdown).toContain("- MCP db blocked: deniedMcpServers");
    expect(markdown).toContain("- Write(src/a.ts): ASK");
  });
});
