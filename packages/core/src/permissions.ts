import { managedDirFor, userClaudeDir, type ResolveRun } from "./context.js";
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

/**
 * Evaluation order of the merged rule set: the first matching rule in this
 * order decides, whatever layer it came from.
 */
const DECISION_ORDER: readonly PermissionDecision[] = ["deny", "ask", "allow"];

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
 * Directory a single-slash specifier (`/docs/**`) is anchored at.
 *
 * Claude Code resolves `/path` against the directory the settings file belongs
 * to: the project root for project and local settings, `~/.claude` for user
 * settings, and the managed settings directory for managed settings. For a
 * settings file discovered in a nested directory we anchor at that directory
 * (the parent of its `.claude/`), which is the same formula as the project
 * root one layer down.
 */
export function settingsAnchorDir(
  run: ResolveRun,
  layer: ConfigLayer,
  settingsPath: string,
): string {
  if (layer === "managed") return managedDirFor(run.platform);
  if (layer === "user") return userClaudeDir(run);
  if (layer === "project" || layer === "local") return run.folder;
  // `directory` layer: `<dir>/.claude/settings.json` → `<dir>`.
  return run.p.dirname(run.p.dirname(settingsPath));
}

export interface SpecifierContext {
  /** Directory a single leading `/` is anchored at. */
  anchorDir: string;
  /** Decision of the rule; `deny`/`ask` patterns also match at any depth. */
  decision: PermissionDecision;
}

/**
 * Does the rule's path specifier hit the resolved target?
 *
 * Path syntax, as Claude Code reads it:
 *
 * - `//abs/path` — filesystem-absolute;
 * - `~/path` — relative to the home directory;
 * - `path` and `./path` — relative to the project root (primary working dir);
 * - `/path` — relative to the settings source's own directory (see
 *   `settingsAnchorDir`).
 *
 * For a file target the specifier has to match the file itself. For a
 * directory target it is enough that the specifier *could* cover something at
 * or below the directory, which is what `globCoversDirectory` decides.
 *
 * `deny` and `ask` rules additionally get gitignore-style depth: a
 * single-segment directory pattern such as `Read(secrets/**)` matches a
 * `secrets/` directory at any depth, not just at the anchor.
 */
export function specifierMatchesTarget(
  run: ResolveRun,
  tool: string,
  specifier: string | undefined,
  context: SpecifierContext,
): boolean {
  if (!FILE_TOOLS.has(tool)) return false;
  if (specifier === undefined) return true;

  const raw = specifier.trim();
  if (raw.length === 0) return true;

  const hits = run.targetKind === "directory" ? globCoversDirectory : matchGlob;
  const absoluteTarget = toPosix(run.file);
  const test = (pattern: string): boolean => hits(toPosix(pattern), absoluteTarget);

  // `//abs/path` — one slash is stripped, the rest is a filesystem path.
  if (raw.startsWith("//")) return test(raw.slice(1));
  if (raw.startsWith("~/")) return test(`${toPosix(run.homeDir)}/${raw.slice(2)}`);
  if (run.p.isAbsolute(raw)) {
    // A single leading `/` anchors at the settings source's directory.
    return test(`${toPosix(context.anchorDir)}/${raw.replace(/^\/+/, "")}`);
  }

  const explicitlyAnchored = raw.startsWith("./");
  const relative = toPosix(raw.replace(/^\.\//, ""));
  const root = toPosix(run.folder);
  if (test(`${root}/${relative}`)) return true;

  // gitignore-style: `secrets/**` (one literal segment, then a wildcard tail)
  // also denies/asks for a `secrets/` directory nested anywhere below. Writing
  // it as `./secrets/**` pins it to the root instead.
  if (explicitlyAnchored || context.decision === "allow") return false;
  const anyDepth = anyDepthPattern(relative);
  return anyDepth !== undefined && test(`${root}/${anyDepth}`);
}

/**
 * `secrets/**` → `**\/secrets/**`: a pattern whose first segment is literal
 * and whose remainder is a wildcard tail is read at any depth. Anything else
 * (a multi-segment literal path like `src/api/**`, or a pattern that already
 * starts with a wildcard) stays anchored.
 */
function anyDepthPattern(pattern: string): string | undefined {
  const match = /^([^/*?]+)\/(\*\*.*|\*)$/.exec(pattern);
  if (!match) return undefined;
  return `**/${pattern}`;
}

/** Every permission rule across the settings layers, lowest precedence first. */
export function collectPermissions(
  run: ResolveRun,
  settings: SettingsEntry[],
): PermissionRule[] {
  const ordered = [...settings].sort(
    (a, b) =>
      CONFIG_LAYER_PRECEDENCE.indexOf(a.layer) - CONFIG_LAYER_PRECEDENCE.indexOf(b.layer),
  );

  const rules: PermissionRule[] = [];
  for (const entry of ordered) {
    const permissions = entry.values["permissions"];
    if (!isRecord(permissions)) continue;
    const anchorDir = settingsAnchorDir(run, entry.layer, entry.path);
    for (const { key, decision } of DECISIONS) {
      for (const text of asStringArray(permissions[key])) {
        const { tool, specifier } = parseRuleText(text);
        const rule: PermissionRule = {
          path: entry.path,
          layer: entry.layer,
          rule: text,
          tool,
          decision,
          matchesFile: specifierMatchesTarget(run, tool, specifier, {
            anchorDir,
            decision,
          }),
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
 * Do two rules compete for the same invocation of the selected target?
 *
 * Claude Code merges every layer's rules into one set, so competition is about
 * what the rules cover, not where they were written. Two rules for the same
 * tool compete when both hit the resolved target — a bare `Read` (which covers
 * every invocation of the tool) competes with `Read(./src/secret.ts)` when the
 * target is that file. For tools whose specifier is not a path we cannot tell
 * from a file/folder selection which invocations overlap, so we fall back to
 * identical rule text (`Bash(npm run build)` allow vs deny).
 */
function competes(a: PermissionRule, b: PermissionRule): boolean {
  if (a.tool !== b.tool) return false;
  if (a.matchesFile && b.matchesFile) return true;
  return a.rule === b.rule;
}

const decisionRank = (decision: PermissionDecision): number =>
  DECISION_ORDER.indexOf(decision);

/**
 * Mark the rules that lose to a stronger one in the merged set.
 *
 * The merged set is evaluated `deny` → `ask` → `allow` and the first match
 * wins, regardless of layer (managed rules simply sit in the same set; a
 * managed `deny` therefore still wins everything). So among the rules that
 * compete for the selected target, the strongest decision wins and every
 * competitor with a weaker decision is overridden. Ties keep the previous
 * behaviour: two competing rules with the *same* decision never override each
 * other, and when several rules share the winning decision the one from the
 * highest layer is reported as `overriddenBy`.
 *
 * A rule that does not match the target (and has no same-text competitor) is
 * neither winning nor overridden — it is simply not in play here.
 */
function markOverrides(rules: PermissionRule[]): void {
  const rank = (layer: ConfigLayer): number => CONFIG_LAYER_PRECEDENCE.indexOf(layer);

  for (const rule of rules) {
    let winner: PermissionRule | undefined;
    for (const other of rules) {
      if (other === rule) continue;
      if (!competes(rule, other)) continue;
      if (decisionRank(other.decision) >= decisionRank(rule.decision)) continue;
      if (!winner || rank(other.layer) >= rank(winner.layer)) winner = other;
    }
    if (winner) {
      rule.overridden = true;
      rule.overriddenBy = winner.layer;
    }
  }
}
