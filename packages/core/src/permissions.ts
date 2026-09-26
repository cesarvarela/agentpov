import { ancestorsOf, userClaudeDir, type ResolveRun } from "./context.js";
import { globCoversDirectory, matchGlob } from "./glob.js";
import { asStringArray, isRecord } from "./json.js";
import { toAbsolute, toPosix } from "./paths.js";
import { asBoolean, effectiveSetting, settingsByPriority, valueAt } from "./settings.js";
import {
  CONFIG_LAYER_PRECEDENCE,
  type ConfigLayer,
  type ConfigSource,
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

/**
 * Tools whose `Tool(path)` rules Claude Code accepts but never consults.
 * Docs (/permissions, "Read and Edit", v2.1.210+): file permissions are
 * checked against `Edit(path)` and `Read(path)` only; a path rule for `Write`,
 * `NotebookEdit`, `Glob` or `MultiEdit` warns at startup and does nothing. A
 * bare tool-name rule (`Write`) still applies at the tool level. `NotebookRead`
 * is a legacy name that falls under the same "Read and Edit only" sentence.
 */
const UNCONSULTED_PATH_TOOLS = new Set([
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "NotebookRead",
  "Glob",
]);

/**
 * Tools a matching `Read(path)` deny also blocks. Docs (/permissions, "Read
 * and Edit"): a `Read` deny rule blocks the Edit and Write tools on the same
 * path (v2.1.208+ for edits, v2.1.228+ for writes); NotebookEdit isn't covered.
 */
const BLOCKED_BY_READ_DENY = new Set(["Edit", "Write"]);

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
 * Docs (/permissions, "Read and Edit", checked for Claude Code 2.1.280): a
 * `/path` pattern anchors at a directory associated with the settings source:
 *
 * - project and local settings → the primary working directory (local rules
 *   anchor there even when the file lives at the repository root, v2.1.211+);
 * - user settings → `~/.claude` (`CLAUDE_CONFIG_DIR` when set);
 * - a `--settings <file>` → the file's directory.
 *
 * Managed settings aren't in the docs' table. We follow the `--settings` row
 * and use the managed settings file's own directory (the directory that holds
 * `managed-settings.json`, also for its `managed-settings.d/` drop-ins). For a
 * settings file discovered in a nested directory we anchor at that directory
 * (the parent of its `.claude/`), the same formula as the project root.
 */
export function settingsAnchorDir(
  run: ResolveRun,
  layer: ConfigLayer,
  settingsPath: string,
): string {
  if (layer === "managed") return run.p.dirname(run.managedSettingsPath);
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

/** `Read(!sample.env)`: a gitignore negation, which carves out, never matches. */
export function isNegatedSpecifier(specifier: string | undefined): boolean {
  return specifier !== undefined && specifier.trim().startsWith("!");
}

/**
 * The absolute, posix glob(s) a path specifier stands for; `[]` when the
 * specifier is not a path pattern (a `!` negation, or empty).
 *
 * Path syntax (docs: /permissions, "Read and Edit", Claude Code 2.1.280):
 *
 * - `//abs/path` — filesystem-absolute;
 * - `~/path` — relative to the home directory;
 * - `/path` — relative to the settings source's own directory (see
 *   `settingsAnchorDir`), never the filesystem root;
 * - `path` and `./path` — relative to the primary working directory.
 *
 * Relative patterns follow gitignore depth rules:
 *
 * - a bare name with no `/` (`.env`, `*.env`, `src`) matches at any depth
 *   under the working directory, for every rule type: "`Read(.env)` and
 *   `Read(**\/.env)` are equivalent";
 * - a single literal segment followed by a wildcard tail (`secrets/**`)
 *   matches at any depth in `deny` and `ask` rules, but only at the root in
 *   `allow` rules;
 * - every other shape (`src/api/**`, `**\/src/**`) matches where it says.
 *
 * Writing `./` pins a pattern to the working directory (`./.env`,
 * `./secrets/**`): the docs' examples use `./` for the root-only form.
 */
export function resolvePermissionPatterns(
  run: ResolveRun,
  specifier: string | undefined,
  context: SpecifierContext,
): string[] {
  if (specifier === undefined) return [];
  const raw = specifier.trim();
  if (raw.length === 0 || raw.startsWith("!")) return [];

  // `//abs/path` — one slash is stripped, the rest is a filesystem path.
  if (raw.startsWith("//")) return [toPosix(raw.slice(1))];
  if (raw === "~" || raw.startsWith("~/")) {
    return [joinPattern(toPosix(run.homeDir), raw.slice(2))];
  }
  if (raw.startsWith("/") || run.p.isAbsolute(raw)) {
    // A single leading `/` anchors at the settings source's directory.
    return [joinPattern(toPosix(context.anchorDir), raw.replace(/^[/\\]+/, ""))];
  }
  return relativePatterns(run, raw, context.decision);
}

function joinPattern(base: string, rest: string): string {
  const cleanBase = base.replace(/\/+$/, "");
  const cleanRest = toPosix(rest).replace(/^\/+/, "");
  if (cleanRest.length === 0 || cleanRest === ".") return cleanBase || "/";
  return `${cleanBase}/${cleanRest}`;
}

/** `path` / `./path`, resolved against the primary working directory. */
function relativePatterns(
  run: ResolveRun,
  raw: string,
  decision: PermissionDecision,
): string[] {
  const root = toPosix(run.folder);
  const explicitlyAnchored = raw.startsWith("./");
  const relative = toPosix(raw.replace(/^\.\//, ""));
  if (relative.length === 0 || relative === ".") return [root];
  if (explicitlyAnchored) return [joinPattern(root, relative)];

  // gitignore: a pattern without a slash (a trailing one aside) is a name
  // that matches at any depth. A wildcard-free name also covers the contents
  // of a directory with that name.
  const name = relative.replace(/\/+$/, "");
  if (!name.includes("/")) {
    const anyDepth = `${root}/**/${name}`;
    return /[*?[]/.test(name) ? [anyDepth] : [anyDepth, `${anyDepth}/**`];
  }

  // `secrets/**` also denies/asks for a `secrets/` directory nested anywhere
  // below; an `allow` stays at the root.
  if (decision !== "allow" && anyDepthPattern(relative) !== undefined) {
    return [`${root}/**/${relative}`];
  }
  return [joinPattern(root, relative)];
}

/**
 * Does the rule's path specifier hit the resolved target?
 *
 * For a file target the specifier has to match the file itself. For a
 * directory target it is enough that the specifier *could* cover something at
 * or below the directory, which is what `globCoversDirectory` decides. See
 * `resolvePermissionPatterns` for the path syntax.
 */
export function specifierMatchesTarget(
  run: ResolveRun,
  tool: string,
  specifier: string | undefined,
  context: SpecifierContext,
): boolean {
  if (!FILE_TOOLS.has(tool)) return false;
  if (specifier === undefined || specifier.trim().length === 0) return true;
  return resolvePermissionPatterns(run, specifier, context).some((pattern) =>
    patternHitsTarget(run, pattern),
  );
}

function patternHitsTarget(run: ResolveRun, pattern: string): boolean {
  const hits = run.targetKind === "directory" ? globCoversDirectory : matchGlob;
  return hits(pattern, toPosix(run.file));
}

/**
 * `secrets/**` → matches at any depth: a pattern whose first segment is
 * literal and whose remainder is a wildcard tail. Anything else (a
 * multi-segment literal path like `src/api/**`, or a pattern that already
 * starts with a wildcard) stays anchored.
 */
function anyDepthPattern(pattern: string): string | undefined {
  const match = /^([^/*?]+)\/(\*\*.*|\*)$/.exec(pattern);
  if (!match) return undefined;
  return `**/${pattern}`;
}

/**
 * `allowManagedPermissionRulesOnly` (managed only). Docs (/settings-reference,
 * "Permission settings"): Claude Code then ignores `allow`, `ask` and `deny`
 * rules from user, project, local and `--settings` files.
 */
export function managedPermissionRulesOnly(settings: SettingsEntry[]) {
  return effectiveSetting(settings, "allowManagedPermissionRulesOnly", {
    parse: asBoolean,
    default: false,
    layers: ["managed"],
  });
}

/**
 * Every permission rule across the settings layers, lowest precedence first.
 *
 * Rules Claude Code drops carry `ignored` (non-managed rules under
 * `allowManagedPermissionRulesOnly`, `Write(path)`-style rules it never
 * consults) and never override or get overridden. Their `matchesFile` is still
 * computed, so a consumer deciding a verdict must skip `ignored` rules (and
 * `overridden` ones) itself.
 */
export function collectPermissions(
  run: ResolveRun,
  settings: SettingsEntry[],
): PermissionRule[] {
  const ordered = [...settings].sort(
    (a, b) =>
      CONFIG_LAYER_PRECEDENCE.indexOf(a.layer) - CONFIG_LAYER_PRECEDENCE.indexOf(b.layer),
  );
  const managedOnly = managedPermissionRulesOnly(settings);

  const rules: PermissionRule[] = [];
  for (const entry of ordered) {
    const permissions = entry.values["permissions"];
    if (!isRecord(permissions)) continue;
    const anchorDir = settingsAnchorDir(run, entry.layer, entry.path);
    for (const { key, decision } of DECISIONS) {
      const list: PermissionRule[] = [];
      for (const text of asStringArray(permissions[key])) {
        const { tool, specifier } = parseRuleText(text);
        const rule: PermissionRule = {
          path: entry.path,
          layer: entry.layer,
          rule: text,
          tool,
          decision,
          matchesFile:
            !isNegatedSpecifier(specifier) &&
            specifierMatchesTarget(run, tool, specifier, { anchorDir, decision }),
          overridden: false,
        };
        if (specifier !== undefined) rule.specifier = specifier;
        if (managedOnly.value && entry.layer !== "managed") {
          rule.ignored = `allowManagedPermissionRulesOnly in ${managedOnly.source?.path ?? "managed settings"}: only managed rules apply`;
        } else if (specifier !== undefined && UNCONSULTED_PATH_TOOLS.has(tool)) {
          rule.ignored = `Claude Code never consults ${tool}(path) rules; use Edit(...) or Read(...)`;
        }
        list.push(rule);
      }
      if (decision !== "allow") applyCarveOuts(run, list);
      rules.push(...list);
    }
  }

  markOverrides(rules);
  return rules;
}

/**
 * gitignore negation in one settings file's `deny` or `ask` list. Docs
 * (/permissions, "Read and Edit"): a `!` pattern carves the paths it matches
 * out of the `path` / `./path` rules listed before it in the same source.
 *
 * - it's read relative to the working directory even after `/`, `~/` or
 *   `//`, so it can't reach a rule anchored with one of those;
 * - it can't reopen a file inside a directory an earlier rule blocks as a
 *   whole (`secrets/**` then `!secrets/public/**` still blocks
 *   `secrets/public`).
 *
 * Only file targets are carved: for a directory target, "the rule covers
 * something inside" stays true whatever the negation exempts.
 */
function applyCarveOuts(run: ResolveRun, list: PermissionRule[]): void {
  if (run.targetKind !== "file") return;
  const target = toPosix(run.file);
  list.forEach((negation, index) => {
    if (negation.ignored || !isNegatedSpecifier(negation.specifier)) return;
    const body = negation.specifier!.trim().slice(1).trim();
    // A leading `/` in gitignore anchors at the root the pattern is read from.
    const patterns = body.startsWith("/")
      ? [joinPattern(toPosix(run.folder), body.replace(/^\/+/, ""))]
      : relativePatterns(run, body, negation.decision);
    if (!patterns.some((pattern) => matchGlob(pattern, target))) return;

    for (const earlier of list.slice(0, index)) {
      if (earlier.tool !== negation.tool || earlier.ignored) continue;
      if (!earlier.matchesFile || earlier.carvedOutBy) continue;
      const spec = earlier.specifier?.trim();
      if (!spec || spec.startsWith("!") || spec.startsWith("/") || spec.startsWith("~")) {
        continue;
      }
      if (blocksAnAncestor(run, earlier)) continue;
      earlier.carvedOutBy = negation.rule;
      earlier.matchesFile = false;
    }
  });
}

/** Does `rule` match a directory above `target` (so it blocks it as a whole)? */
function blocksAnAncestor(run: ResolveRun, rule: PermissionRule): boolean {
  const patterns = resolvePermissionPatterns(run, rule.specifier, {
    anchorDir: run.folder,
    decision: rule.decision,
  });
  const root = toPosix(run.folder);
  for (const dir of ancestorsOf(run.p, run.p.dirname(run.file)).map(toPosix)) {
    if (dir !== root && !dir.startsWith(`${root}/`)) break;
    if (patterns.some((pattern) => matchGlob(pattern, dir))) return true;
  }
  return false;
}

/**
 * `permissions.blockReadsOutsideWorkingDirectories`. Docs
 * (/settings-reference, v2.1.257+): if any settings source sets `true`, the
 * block applies, so a later `false` can't lift it. Returns the file that
 * turned it on.
 */
export function blockReadsOutsideWorkingDirectories(
  settings: SettingsEntry[],
): ConfigSource | undefined {
  for (const entry of settingsByPriority(settings)) {
    if (valueAt(entry.values, "permissions.blockReadsOutsideWorkingDirectories") === true) {
      return { path: entry.path, layer: entry.layer };
    }
  }
  return undefined;
}

/**
 * `permissions.additionalDirectories` from every settings file, resolved:
 * `~/` against the home directory, relative entries against the working
 * directory (docs' example is `../docs/`). Workspace trust for project
 * entries is not modelled.
 */
export function additionalDirectories(
  run: ResolveRun,
  settings: SettingsEntry[],
): (ConfigSource & { dir: string })[] {
  const out: (ConfigSource & { dir: string })[] = [];
  for (const entry of settings) {
    const raw = asStringArray(valueAt(entry.values, "permissions.additionalDirectories"));
    for (const value of raw) {
      const trimmed = value.trim();
      if (trimmed.length === 0) continue;
      const dir =
        trimmed === "~" || trimmed.startsWith("~/")
          ? toAbsolute(run.p, run.homeDir, trimmed.slice(2) || ".")
          : toAbsolute(run.p, run.folder, trimmed);
      out.push({ path: entry.path, layer: entry.layer, dir });
    }
  }
  return out;
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
 *
 * Across tools: a `Read(path)` deny that hits the target also blocks `Edit`
 * and `Write` there (docs: /permissions, "Read and Edit"), so it competes with
 * an `Edit`/`Write` rule that hits the target.
 */
function competes(rule: PermissionRule, other: PermissionRule): boolean {
  if (rule.tool !== other.tool) {
    return (
      other.tool === "Read" &&
      other.decision === "deny" &&
      other.specifier !== undefined &&
      BLOCKED_BY_READ_DENY.has(rule.tool) &&
      rule.matchesFile &&
      other.matchesFile
    );
  }
  if (rule.matchesFile && other.matchesFile) return true;
  return rule.rule === other.rule && !rule.carvedOutBy && !other.carvedOutBy;
}

const decisionRank = (decision: PermissionDecision): number =>
  DECISION_ORDER.indexOf(decision);

/**
 * Mark the rules that lose to a stronger one in the merged set.
 *
 * Docs (/permissions, "Manage permissions" and "Settings precedence"): the
 * merged set is evaluated `deny` → `ask` → `allow` and the first match wins,
 * regardless of layer or specificity; a deny at any level can't be lifted by
 * any other level. So among the rules that compete for the selected target,
 * the strongest decision wins and every competitor with a weaker decision is
 * overridden. Two competing rules with the *same* decision never override
 * each other, and when several rules share the winning decision the one from
 * the highest layer is reported as `overriddenBy`.
 *
 * Ignored rules (see `collectPermissions`) sit outside the set: they neither
 * override nor get overridden. A rule that does not match the target (and has
 * no same-text competitor) is neither winning nor overridden.
 */
function markOverrides(rules: PermissionRule[]): void {
  const rank = (layer: ConfigLayer): number => CONFIG_LAYER_PRECEDENCE.indexOf(layer);
  const live = rules.filter((rule) => !rule.ignored);

  for (const rule of live) {
    let winner: PermissionRule | undefined;
    for (const other of live) {
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
