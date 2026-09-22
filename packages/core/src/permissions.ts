import { type ResolveRun } from "./context.js";
import { globCoversDirectory, matchGlob } from "./glob.js";
import { asStringArray, isRecord } from "./json.js";
import { toPosix } from "./paths.js";
import {
  CONFIG_LAYER_PRECEDENCE,
  type ConfigLayer,
  type PermissionDecision,
  type PermissionRule,
  type SettingsEntry,
} from "./types.js";

const DECISIONS: { key: string; decision: PermissionDecision }[] = [
  { key: "allow", decision: "allow" },
  { key: "ask", decision: "ask" },
  { key: "deny", decision: "deny" },
];

/** Tools whose specifier is a filesystem path, so it can match the target. */
const FILE_TOOLS = new Set([
  "Read",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "NotebookRead",
]);

export interface ParsedRule {
  tool: string;
  specifier?: string;
}

/** `Bash(git push:*)` → `{ tool: "Bash", specifier: "git push:*" }`. */
export function parseRuleText(rule: string): ParsedRule {
  const trimmed = rule.trim();
  const match = /^([^()\s]+)\s*\(([\s\S]*)\)$/.exec(trimmed);
  if (!match) return { tool: trimmed };
  const specifier = match[2]!;
  const parsed: ParsedRule = { tool: match[1]! };
  if (specifier.length > 0) parsed.specifier = specifier;
  return parsed;
}

/**
 * Does the rule's path specifier hit the resolved target?
 *
 * `//abs/path` is absolute, `~/x` is home-relative, and `/x`, `./x` and bare
 * `x` are all relative to the project root.
 *
 * For a file target the specifier has to match the file itself. For a
 * directory target it is enough that the specifier *could* cover something at
 * or below the directory, which is what `globCoversDirectory` decides.
 */
export function specifierMatchesTarget(
  run: ResolveRun,
  tool: string,
  specifier: string | undefined,
  relativeTarget: string,
): boolean {
  if (!FILE_TOOLS.has(tool)) return false;
  if (specifier === undefined) return true;

  const raw = specifier.trim();
  if (raw.length === 0) return true;

  const hits = run.targetKind === "directory" ? globCoversDirectory : matchGlob;
  const absoluteTarget = toPosix(run.file);
  if (raw.startsWith("//")) {
    return hits(toPosix(raw.slice(1)), absoluteTarget);
  }
  if (raw.startsWith("~/")) {
    return hits(toPosix(`${run.homeDir}/${raw.slice(2)}`), absoluteTarget);
  }
  if (run.p.isAbsolute(raw)) {
    // A single leading `/` is project-root relative in Claude Code settings.
    return hits(toPosix(raw.replace(/^\/+/, "")), relativeTarget);
  }
  const relativePattern = toPosix(raw.replace(/^\.\//, ""));
  return hits(relativePattern, relativeTarget);
}

/** Every permission rule across the settings layers, lowest precedence first. */
export function collectPermissions(
  run: ResolveRun,
  settings: SettingsEntry[],
): PermissionRule[] {
  const relativeTarget = toPosix(run.p.relative(run.folder, run.file));

  const ordered = [...settings].sort(
    (a, b) =>
      CONFIG_LAYER_PRECEDENCE.indexOf(a.layer) - CONFIG_LAYER_PRECEDENCE.indexOf(b.layer),
  );

  const rules: PermissionRule[] = [];
  for (const entry of ordered) {
    const permissions = entry.values["permissions"];
    if (!isRecord(permissions)) continue;
    for (const { key, decision } of DECISIONS) {
      for (const text of asStringArray(permissions[key])) {
        const { tool, specifier } = parseRuleText(text);
        const rule: PermissionRule = {
          path: entry.path,
          layer: entry.layer,
          rule: text,
          tool,
          decision,
          matchesFile: specifierMatchesTarget(run, tool, specifier, relativeTarget),
          overridden: false,
        };
        if (specifier !== undefined) rule.specifier = specifier;
        rules.push(rule);
      }
    }
  }

  markOverrides(rules);
  return rules;
}

/**
 * A rule is overridden when the same rule text appears again, higher up, with a
 * different decision. `deny` is the exception: it is never lifted by a higher
 * `allow` or `ask`.
 */
function markOverrides(rules: PermissionRule[]): void {
  const rank = (layer: ConfigLayer): number => CONFIG_LAYER_PRECEDENCE.indexOf(layer);

  for (const rule of rules) {
    if (rule.decision === "deny") continue;
    let winner: PermissionRule | undefined;
    for (const other of rules) {
      if (other === rule) continue;
      if (other.rule !== rule.rule) continue;
      if (other.decision === rule.decision) continue;
      if (rank(other.layer) <= rank(rule.layer)) continue;
      if (!winner || rank(other.layer) >= rank(winner.layer)) winner = other;
    }
    if (winner) {
      rule.overridden = true;
      rule.overriddenBy = winner.layer;
    }
  }
}
