import { ancestorsOf, userClaudeDir, userConfigJsonPath, type ResolveRun } from "./context.js";
import { globCoversDirectory, globToRegExp, matchGlob } from "./glob.js";
import { asStringArray, isRecord } from "./json.js";
import {
  additionalDirectories,
  blockReadsOutsideWorkingDirectories,
  isNegatedSpecifier,
  resolvePermissionPatterns,
  settingsAnchorDir,
} from "./permissions.js";
import { toPosix } from "./paths.js";
import { asBoolean, effectiveSetting, valueAt } from "./settings.js";
import {
  type ConfigSource,
  type EffectiveValue,
  type PermissionRule,
  type SandboxListItem,
  type SandboxPathKind,
  type SandboxPathRule,
  type SandboxSummary,
  type SettingsEntry,
} from "./types.js";

/*
 * The Bash sandbox, checked against the docs for Claude Code 2.1.280
 * (/sandboxing and /settings-reference, "Sandbox settings").
 *
 * Scope: the sandbox covers Bash, PowerShell and Monitor commands and their
 * children only. Read, Edit and Write stay under permission rules.
 *
 * Merging: a boolean comes from the highest-precedence file that sets it
 * (`effectiveSetting`); every array concatenates across all files, except
 * where a managed-only lock applies (`allowManagedReadPathsOnly` for
 * `allowRead`, `allowManagedDomainsOnly` for allowed domains). There is no
 * lock for `excludedCommands`, `denyRead`, `denyWrite`, `allowWrite` or
 * `deniedDomains`.
 *
 * Keys a layer can't set, and what we do with them:
 *
 * - `filesystem.disabled`: user or managed only (plus `--settings`); only
 *   managed once managed settings configure `sandbox.filesystem` at all or
 *   list a `credentials.files` `deny` entry. Ignored elsewhere with a note.
 *   (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, which ignores it everywhere, is an
 *   env var we can't see.)
 * - `filesystem.allowManagedReadPathsOnly`, `network.allowManagedDomainsOnly`:
 *   managed only.
 * - `credentials.files` `mask` entries: user or managed only; dropped from
 *   project and local files.
 * - Not modelled (no effect on the lists or the verdict): `strictAllowlist`,
 *   `tlsTerminate`, `allowAppleEvents`, `ripgrep`, `socatPath`, the rest of
 *   `credentials`.
 */

type BooleanSetting = EffectiveValue<boolean>;

/** The Bash sandbox as the settings layers and permission rules configure it. */
export function collectSandbox(
  run: ResolveRun,
  settings: SettingsEntry[],
  permissions: PermissionRule[],
): SandboxSummary {
  const enabled = effectiveSetting(settings, "sandbox.enabled", {
    parse: asBoolean,
    default: false,
  });
  if (enabled.value && run.platform === "win32") {
    enabled.note = joinNotes(
      enabled.note,
      "the sandbox doesn't run on native Windows, only inside WSL2",
    );
  }
  const filesystemDisabled = collectFilesystemDisabled(settings);
  const filesystem = collectFilesystem(run, settings, permissions);

  const summary: SandboxSummary = {
    enabled,
    autoAllowBashIfSandboxed: effectiveSetting(settings, "sandbox.autoAllowBashIfSandboxed", {
      parse: asBoolean,
      default: true,
    }),
    allowUnsandboxedCommands: effectiveSetting(settings, "sandbox.allowUnsandboxedCommands", {
      parse: asBoolean,
      default: true,
    }),
    filesystemDisabled,
    excludedCommands: listItems(settings, "sandbox.excludedCommands"),
    filesystem,
    ...collectDomains(settings, permissions),
    target: null,
  };

  if (enabled.value && run.platform !== "win32") {
    summary.target = decideTarget(run, settings, filesystem, filesystemDisabled);
  }
  return summary;
}

function joinNotes(...notes: (string | undefined)[]): string {
  return notes.filter((note): note is string => Boolean(note)).join("; ");
}

// --- settings values -------------------------------------------------------

/**
 * `sandbox.filesystem.disabled`. Docs (/sandboxing, "Which settings can
 * disable it"): honored from user and managed settings (and `--settings`),
 * never from project or local files; once managed settings configure
 * `sandbox.filesystem` at all, or list a `credentials.files` entry with
 * `"mode": "deny"`, only managed settings can set it.
 */
function collectFilesystemDisabled(settings: SettingsEntry[]): BooleanSetting {
  const managedPins = settings.find(
    (entry) =>
      entry.layer === "managed" &&
      (isRecord(valueAt(entry.values, "sandbox.filesystem")) ||
        credentialFiles(entry).some((file) => file.mode === "deny")),
  );
  return effectiveSetting(settings, "sandbox.filesystem.disabled", {
    parse: asBoolean,
    default: false,
    layers: ["managed", "user"],
    reject: (_value, entry) =>
      managedPins && entry.layer !== "managed"
        ? `managed settings (${managedPins.path}) configure the sandbox filesystem, so only they can set it`
        : undefined,
  });
}

/** A string list at `key` from every settings file, in load order. */
function listItems(settings: SettingsEntry[], key: string): SandboxListItem[] {
  const out: SandboxListItem[] = [];
  for (const entry of settings) {
    for (const value of asStringArray(valueAt(entry.values, key))) {
      out.push({ path: entry.path, layer: entry.layer, value });
    }
  }
  return out;
}

/**
 * Allowed and denied domains: `sandbox.network.*Domains` from every file plus
 * `WebFetch(domain:...)` allow and deny rules (a bare `WebFetch` rule doesn't
 * feed the sandbox; docs: /permissions, "Allow or deny every fetch").
 *
 * Under managed `allowManagedDomainsOnly` only managed `allowedDomains` and
 * managed `WebFetch(domain:...)` allow rules count; denied domains still merge
 * from every source (docs: /settings-reference, `sandbox.network.*`).
 */
function collectDomains(
  settings: SettingsEntry[],
  permissions: PermissionRule[],
): Pick<SandboxSummary, "allowedDomains" | "deniedDomains"> {
  const lock = effectiveSetting(settings, "sandbox.network.allowManagedDomainsOnly", {
    parse: asBoolean,
    default: false,
    layers: ["managed"],
  });

  const fromRules = (decision: "allow" | "deny"): SandboxListItem[] =>
    permissions.flatMap((rule) => {
      if (rule.ignored || rule.tool !== "WebFetch" || rule.decision !== decision) return [];
      const specifier = rule.specifier?.trim();
      if (!specifier?.startsWith("domain:")) return [];
      const value = specifier.slice("domain:".length).trim();
      if (value.length === 0) return [];
      return [{ path: rule.path, layer: rule.layer, value, fromPermission: rule.rule }];
    });

  const allowedDomains = [
    ...listItems(settings, "sandbox.network.allowedDomains"),
    ...fromRules("allow"),
  ];
  if (lock.value) {
    for (const item of allowedDomains) {
      if (item.layer !== "managed") {
        item.ignored = `allowManagedDomainsOnly in ${lock.source?.path ?? "managed settings"}: only managed domains apply`;
      }
    }
  }
  return {
    allowedDomains,
    deniedDomains: [...listItems(settings, "sandbox.network.deniedDomains"), ...fromRules("deny")],
  };
}

interface CredentialFile {
  path: string;
  mode: "deny" | "mask";
}

function credentialFiles(entry: SettingsEntry): CredentialFile[] {
  const files = valueAt(entry.values, "sandbox.credentials.files");
  if (!Array.isArray(files)) return [];
  return files.flatMap((file): CredentialFile[] => {
    if (!isRecord(file) || typeof file["path"] !== "string") return [];
    const mode = file["mode"];
    return mode === "deny" || mode === "mask" ? [{ path: file["path"], mode }] : [];
  });
}

// --- filesystem lists ------------------------------------------------------

const PATH_KINDS: readonly SandboxPathKind[] = [
  "allowWrite",
  "denyWrite",
  "denyRead",
  "allowRead",
];

const WILDCARD = /[*?[]/;

/**
 * Every `sandbox.filesystem` path list entry, plus what permission rules and
 * credential entries add to them:
 *
 * - `Edit(path)` allow → `allowWrite`, `Edit(path)` deny → `denyWrite`,
 *   `Read(path)` deny → `denyRead` (docs: /settings-reference,
 *   `sandbox.filesystem`). Rules without a path and `!` carve-outs add
 *   nothing; ignored rules (e.g. under `allowManagedPermissionRulesOnly`) are
 *   skipped. The rule's own path syntax decides the path (`/x` is
 *   settings-relative there, gitignore depth applies).
 * - `credentials.files` `deny` → a read block like `denyRead`. A `mask` entry
 *   is a read block only on macOS (Linux and WSL2 serve a sentinel copy), and
 *   only from user or managed settings.
 */
function collectFilesystem(
  run: ResolveRun,
  settings: SettingsEntry[],
  permissions: PermissionRule[],
): SandboxPathRule[] {
  const readLock = effectiveSetting(settings, "sandbox.filesystem.allowManagedReadPathsOnly", {
    parse: asBoolean,
    default: false,
    layers: ["managed"],
  });

  const out: SandboxPathRule[] = [];
  const add = (
    source: ConfigSource,
    kind: SandboxPathKind,
    pattern: string,
    resolved: string,
    extra: Partial<SandboxPathRule> = {},
  ): void => {
    const rule: SandboxPathRule = {
      path: source.path,
      layer: source.layer,
      kind,
      pattern,
      resolved,
      matchesTarget: pathRuleHitsTarget(run, resolved),
      ...extra,
    };
    const ignored = ignoredReason(run, rule, readLock);
    if (ignored && !rule.ignored) rule.ignored = ignored;
    out.push(rule);
  };

  for (const entry of settings) {
    const anchor = settingsAnchorDir(run, entry.layer, entry.path);
    for (const kind of PATH_KINDS) {
      for (const pattern of asStringArray(valueAt(entry.values, `sandbox.filesystem.${kind}`))) {
        add(entry, kind, pattern, resolveSandboxPath(run, pattern, anchor));
      }
    }
    for (const file of credentialFiles(entry)) {
      if (file.mode === "mask" && run.platform !== "darwin") continue;
      const extra: Partial<SandboxPathRule> = { fromCredentials: file.mode };
      if (file.mode === "mask" && (entry.layer === "project" || entry.layer === "local")) {
        extra.ignored = "credentials mask entries are dropped from project and local settings";
      }
      add(entry, "denyRead", file.path, resolveSandboxPath(run, file.path, anchor), extra);
    }
  }

  for (const rule of permissions) {
    const kind = permissionKind(rule);
    if (!kind || rule.ignored || rule.specifier === undefined) continue;
    if (isNegatedSpecifier(rule.specifier)) continue;
    const [pattern] = resolvePermissionPatterns(run, rule.specifier, {
      anchorDir: settingsAnchorDir(run, rule.layer, rule.path),
      decision: rule.decision,
    });
    if (pattern === undefined) continue;
    add(rule, kind, rule.specifier, stripTrailing(pattern), { fromPermission: rule.rule });
  }
  return out;
}

function permissionKind(rule: PermissionRule): SandboxPathKind | undefined {
  if (rule.tool === "Edit" && rule.decision === "allow") return "allowWrite";
  if (rule.tool === "Edit" && rule.decision === "deny") return "denyWrite";
  if (rule.tool === "Read" && rule.decision === "deny") return "denyRead";
  return undefined;
}

function ignoredReason(
  run: ResolveRun,
  rule: SandboxPathRule,
  readLock: BooleanSetting,
): string | undefined {
  if (rule.kind === "allowRead" && readLock.value && rule.layer !== "managed") {
    return `allowManagedReadPathsOnly in ${readLock.source?.path ?? "managed settings"}: only managed allowRead entries apply`;
  }
  // Docs (/settings-reference, "Sandbox path prefixes"): on Linux and WSL2
  // the sandbox mounts concrete paths, so a write entry with `*`, `?` or `[`
  // left after the trailing `/**` is removed has no effect.
  if (
    (rule.kind === "allowWrite" || rule.kind === "denyWrite") &&
    run.platform === "linux" &&
    WILDCARD.test(rule.resolved)
  ) {
    return "wildcards in allowWrite/denyWrite have no effect on Linux and WSL2";
  }
  return undefined;
}

/** Drops a trailing `/**` and trailing slashes: `~/build/**` and `~/build/` → `~/build`. */
function stripTrailing(value: string): string {
  let out = value;
  for (;;) {
    if (out.endsWith("/**")) out = out.slice(0, -3);
    else if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
    else break;
  }
  // `/**` and `//**` name the filesystem root.
  return out.length === 0 && value.startsWith("/") ? "/" : out;
}

/**
 * A `sandbox.filesystem.*` (or `credentials.files`) path, made absolute.
 *
 * Docs (/settings-reference, "Sandbox path prefixes"):
 *
 * - `/path` and `//path` are filesystem-absolute (unlike permission rules);
 * - `~/path` is under the home directory;
 * - `./path` or no prefix is relative to the project root in project
 *   settings and to `~/.claude` in user settings. The docs don't say for
 *   local or managed settings; we use the same anchor as a permission rule's
 *   `/path` from that file (`settingsAnchorDir`): the working directory for
 *   local settings, the managed settings directory for managed ones.
 *
 * A trailing `/` or `/**` is stripped first.
 */
export function resolveSandboxPath(run: ResolveRun, raw: string, anchorDir: string): string {
  let value = stripTrailing(raw.trim());
  if (value.startsWith("//")) value = value.slice(1);
  if (value === "~" || value.startsWith("~/")) {
    return toPosix(run.p.join(run.homeDir, value.slice(2) || "."));
  }
  if (value.startsWith("/") || run.p.isAbsolute(value)) {
    return stripTrailing(toPosix(run.p.normalize(value)));
  }
  return stripTrailing(toPosix(run.p.join(anchorDir, value)));
}

// --- matching --------------------------------------------------------------

/** Does the (already stripped) sandbox path cover `path` or something above it? */
function covers(pattern: string, path: string): boolean {
  if (pattern === "/") return true;
  return matchGlob(pattern, path) || matchGlob(`${pattern}/**`, path);
}

/** Could the sandbox path cover something at or below `dir`? */
function reachesInto(pattern: string, dir: string): boolean {
  if (pattern === "/") return true;
  return globCoversDirectory(pattern, dir) || globCoversDirectory(`${pattern}/**`, dir);
}

function pathRuleHitsTarget(run: ResolveRun, resolved: string): boolean {
  const target = toPosix(run.file);
  return run.targetKind === "directory" ? reachesInto(resolved, target) : covers(resolved, target);
}

const depthOf = (path: string): number => path.split("/").filter(Boolean).length;

/**
 * How specific a covering entry is for `path`: the depth of the deepest
 * ancestor-or-self of `path` the entry names (a directory entry covers what's
 * under it). `undefined` when it doesn't cover `path`.
 */
function matchDepth(pattern: string, path: string): number | undefined {
  if (pattern === "/") return 0;
  const regex = globToRegExp(pattern);
  let current = path;
  for (;;) {
    if (regex.test(current)) return depthOf(current);
    const slash = current.lastIndexOf("/");
    if (slash <= 0) return undefined;
    current = current.slice(0, slash);
  }
}

const isUnder = (dir: string, path: string): boolean =>
  dir === "/" || path === dir || path.startsWith(`${dir}/`);

// --- the verdict -----------------------------------------------------------

interface Region {
  dir: string;
  label: string;
}

/**
 * Default writable directories. Docs (/sandboxing, "Filesystem isolation"):
 * the working directory, directories added with `--add-dir` or
 * `permissions.additionalDirectories`, the per-user temp directory `$TMPDIR`
 * points to (not visible statically, so not listed), and in a linked
 * worktree the main repository's shared `.git`.
 */
function workingRegions(run: ResolveRun, settings: SettingsEntry[]): Region[] {
  const regions: Region[] = [{ dir: toPosix(run.folder), label: "the working directory" }];
  for (const extra of additionalDirectories(run, settings)) {
    regions.push({
      dir: toPosix(extra.dir),
      label: `additional directory ${toPosix(extra.dir)} (${extra.path})`,
    });
  }
  if (isLinkedWorktree(run)) {
    regions.push({
      dir: toPosix(run.p.join(run.repoRoot, ".git")),
      label: "the main repository's .git (linked worktree)",
    });
  }
  return regions;
}

function isLinkedWorktree(run: ResolveRun): boolean {
  return run.gitRoot !== null && run.repoRoot !== run.gitRoot;
}

/** Shell startup files the docs name ("such as `.bashrc` and `.zshrc`") and their usual siblings. */
const SHELL_STARTUP = [
  ".bashrc",
  ".bash_profile",
  ".bash_login",
  ".profile",
  ".zshrc",
  ".zshenv",
  ".zprofile",
  ".zlogin",
];

/**
 * Paths no `allowWrite` or `Edit` allow can make writable. Docs
 * (/sandboxing, "Protected paths"):
 *
 * - in the working directory and every directory above it: the `.claude`
 *   settings files, `.claude/skills|agents|commands|hooks|workflows`,
 *   `.claude/scheduled_tasks.json`, `.mcp.json`;
 * - in the working directory only: shell startup files, `.gitconfig`,
 *   `.vscode`, `.idea`, `.git/hooks`, `.git/config`;
 * - bare-repo files at the working directory's top level: `HEAD`, `objects`,
 *   `refs`, `config` (`hooks` there only counts beside a `HEAD`, which we
 *   can't check synchronously, so it isn't listed);
 * - `~/.claude` (or `CLAUDE_CONFIG_DIR`) — "most of its contents", taken as
 *   all — and `~/.claude.json`;
 * - in a linked worktree, `hooks` and `config` in the main repository's `.git`.
 */
function protectedPaths(run: ResolveRun): string[] {
  const out: string[] = [];
  const join = (...parts: string[]): string => toPosix(run.p.join(...parts));
  for (const dir of ancestorsOf(run.p, run.folder)) {
    out.push(
      join(dir, ".claude", "settings.json"),
      join(dir, ".claude", "settings.local.json"),
      join(dir, ".claude", "skills"),
      join(dir, ".claude", "agents"),
      join(dir, ".claude", "commands"),
      join(dir, ".claude", "hooks"),
      join(dir, ".claude", "workflows"),
      join(dir, ".claude", "scheduled_tasks.json"),
      join(dir, ".mcp.json"),
    );
  }
  for (const name of [
    ...SHELL_STARTUP,
    ".gitconfig",
    ".vscode",
    ".idea",
    ".git/hooks",
    ".git/config",
    "HEAD",
    "objects",
    "refs",
    "config",
  ]) {
    out.push(join(run.folder, name));
  }
  out.push(toPosix(userClaudeDir(run)), toPosix(userConfigJsonPath(run)));
  if (isLinkedWorktree(run)) {
    out.push(join(run.repoRoot, ".git", "hooks"), join(run.repoRoot, ".git", "config"));
  }
  return out;
}

/**
 * Where `permissions.blockReadsOutsideWorkingDirectories` blocks sandboxed
 * reads (docs: /settings-reference): home directories and mounted-volume
 * roots outside the working directories. We read that as the home directory
 * (and its parent when it is `/Users` or `/home`), `/Volumes` on macOS, and
 * `/mnt` and `/media` on Linux. Returns the blocked root holding `path`.
 */
function blockedReadRoot(run: ResolveRun, path: string): string | undefined {
  const home = toPosix(run.homeDir);
  const roots = [home];
  const homeParent = toPosix(run.p.dirname(run.homeDir));
  if (homeParent === "/Users" || homeParent === "/home") roots.push(homeParent);
  if (run.platform === "darwin") roots.push("/Volumes");
  if (run.platform === "linux") roots.push("/mnt", "/media");
  return roots
    .filter((root) => isUnder(root, path))
    .sort((a, b) => depthOf(b) - depthOf(a))[0];
}

function describe(rule: SandboxPathRule): string {
  if (rule.fromPermission) return `${rule.fromPermission} (${rule.layer} settings)`;
  if (rule.fromCredentials) {
    return `credentials.files "${rule.pattern}" (${rule.fromCredentials}, ${rule.layer} settings)`;
  }
  return `${rule.kind} "${rule.pattern}" (${rule.layer} settings)`;
}

interface Candidate {
  allow: boolean;
  depth: number;
  label: string;
}

/**
 * What a sandboxed Bash command can do to the target.
 *
 * Read (docs: /sandboxing, "Configure sandboxing"): readable by default. When
 * read rules overlap, the narrower path applies: an `allowRead` re-opens a
 * narrower region inside a `denyRead`, and a `denyRead` (exact or wildcard)
 * holds inside a wider `allowRead`. Equal depth → the deny holds.
 * `blockReadsOutsideWorkingDirectories` acts as a deny on the home directory
 * and volume roots outside the working directories, which `allowRead` can
 * re-open.
 *
 * Write: writable only inside the working directory, additional directories,
 * `$TMPDIR` and `allowWrite` paths (including `Edit` allow rules). A
 * protected path is never writable. A `denyWrite` (or `Edit` deny) wins over
 * any allow: the docs describe `denyWrite` as blocking paths "inside a
 * directory that is otherwise writable" and give `allowWrite` no re-open
 * role, unlike `allowRead`.
 *
 * `filesystem.disabled` lifts both (a macOS `mask` credential entry still
 * blocks reads). For a directory target the verdict is for the directory
 * itself, with a hint when something inside it is denied.
 */
function decideTarget(
  run: ResolveRun,
  settings: SettingsEntry[],
  filesystem: SandboxPathRule[],
  filesystemDisabled: BooleanSetting,
): NonNullable<SandboxSummary["target"]> {
  const target = toPosix(run.file);
  const live = filesystem.filter((rule) => !rule.ignored);
  const isDirectory = run.targetKind === "directory";

  if (filesystemDisabled.value) {
    const off = `filesystem isolation is off (sandbox.filesystem.disabled in ${filesystemDisabled.source?.path})`;
    const mask = live.find(
      (rule) => rule.fromCredentials === "mask" && matchDepth(rule.resolved, target) !== undefined,
    );
    return mask
      ? { read: "denied", write: "allowed", reason: `Read: denied by ${describe(mask)}, which holds with isolation off. Write: ${off}.` }
      : { read: "allowed", write: "allowed", reason: `${off[0]!.toUpperCase()}${off.slice(1)}.` };
  }

  const regions = workingRegions(run, settings);

  // --- read
  const candidates: Candidate[] = [];
  for (const rule of live) {
    if (rule.kind !== "denyRead" && rule.kind !== "allowRead") continue;
    const depth = matchDepth(rule.resolved, target);
    if (depth !== undefined) {
      candidates.push({ allow: rule.kind === "allowRead", depth, label: describe(rule) });
    }
  }
  const block = blockReadsOutsideWorkingDirectories(settings);
  if (block && !regions.some((region) => isUnder(region.dir, target))) {
    const root = blockedReadRoot(run, target);
    if (root !== undefined) {
      candidates.push({
        allow: false,
        depth: depthOf(root),
        label: `permissions.blockReadsOutsideWorkingDirectories (${block.layer} settings), which blocks ${root}`,
      });
    }
  }
  candidates.sort((a, b) => b.depth - a.depth || Number(a.allow) - Number(b.allow));
  const readWinner = candidates[0];
  let read: "allowed" | "denied";
  let readReason: string;
  if (!readWinner) {
    read = "allowed";
    readReason = "allowed by default (sandboxed commands can read the whole filesystem)";
  } else if (readWinner.allow) {
    read = "allowed";
    const deny = candidates.find((candidate) => !candidate.allow);
    readReason = deny
      ? `re-opened by ${readWinner.label}, narrower than ${deny.label}`
      : `allowed (${readWinner.label})`;
  } else {
    read = "denied";
    readReason = `denied by ${readWinner.label}`;
  }
  if (read === "allowed" && isDirectory) {
    const inside = live.find(
      (rule) =>
        rule.kind === "denyRead" && rule.matchesTarget && matchDepth(rule.resolved, target) === undefined,
    );
    if (inside) readReason += `; ${describe(inside)} blocks paths inside`;
  }

  // --- write
  let write: "allowed" | "denied";
  let writeReason: string;
  const protectedList = protectedPaths(run);
  const protectedHit = protectedList.find((path) => isUnder(path, target));
  const denyWrite = live
    .filter((rule) => rule.kind === "denyWrite")
    .map((rule) => ({ rule, depth: matchDepth(rule.resolved, target) }))
    .filter((hit) => hit.depth !== undefined)
    .sort((a, b) => b.depth! - a.depth!)[0];
  const region = regions.find((candidate) => isUnder(candidate.dir, target));
  const allowWrite = live.find(
    (rule) => rule.kind === "allowWrite" && matchDepth(rule.resolved, target) !== undefined,
  );

  if (protectedHit) {
    write = "denied";
    writeReason = `denied: ${protectedHit} is a protected path no allowWrite or Edit allow can open`;
  } else if (denyWrite) {
    write = "denied";
    writeReason = `denied by ${describe(denyWrite.rule)}`;
  } else if (region) {
    write = "allowed";
    writeReason = `allowed inside ${region.label}`;
  } else if (allowWrite) {
    write = "allowed";
    writeReason = `allowed by ${describe(allowWrite)}`;
  } else {
    write = "denied";
    writeReason =
      "denied: outside the working directory, additional directories, $TMPDIR and every allowWrite path";
  }
  if (write === "allowed" && isDirectory) {
    const insideDeny = live.find(
      (rule) =>
        rule.kind === "denyWrite" && rule.matchesTarget && matchDepth(rule.resolved, target) === undefined,
    );
    const insideProtected = protectedList.find(
      (path) => path !== target && path.startsWith(`${target === "/" ? "" : target}/`),
    );
    if (insideDeny) writeReason += `; ${describe(insideDeny)} blocks paths inside`;
    else if (insideProtected) writeReason += `; protected paths inside stay read-only (${insideProtected})`;
  }

  return { read, write, reason: `Read: ${readReason}. Write: ${writeReason}.` };
}
