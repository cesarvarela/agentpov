import {
  listDir,
  managedDirFor,
  projectClaudeDir,
  readText,
  userClaudeDir,
  type ResolveRun,
} from "./context.js";
import { isRecord, parseLenientJson } from "./json.js";
import {
  type ConfigLayer,
  type EffectiveValue,
  type SettingsEntry,
} from "./types.js";

export function managedSettingsPathFor(platform: NodeJS.Platform): string {
  const dir = managedDirFor(platform);
  const separator = platform === "win32" ? "\\" : "/";
  return `${dir}${separator}managed-settings.json`;
}

/**
 * Reads a JSON file, recording a diagnostic when it is present but unparseable.
 * Returns `undefined` when the file is absent or invalid.
 */
export async function readJsonFile(
  run: ResolveRun,
  path: string,
): Promise<Record<string, unknown> | undefined> {
  const content = await readText(run, path);
  if (content === null) return undefined;
  const parsed = parseLenientJson(content);
  if (!isRecord(parsed)) {
    run.diagnostics.push(`${path}: invalid JSON`);
    return undefined;
  }
  return parsed;
}

/**
 * Settings files for each layer, in load order: managed (the file, then each
 * `managed-settings.d/*.json` drop-in alphabetically), user, project, local.
 *
 * Load order is not precedence: managed settings override every other layer
 * for single values. Use `settingsByPriority` to decide a single value.
 *
 * Project settings come from `folder` only. Local settings come from `folder`
 * and, when it differs, the main checkout's root: Claude Code 2.1.280 reads
 * `<repoRoot>/.claude/settings.local.json` for a subfolder of a repository
 * and for a linked worktree, and never the `settings.json` next to it.
 */
export async function collectSettings(run: ResolveRun): Promise<SettingsEntry[]> {
  const { p } = run;
  const claudeDir = projectClaudeDir(run);
  const candidates: { path: string; layer: ConfigLayer }[] = [
    { path: run.managedSettingsPath, layer: "managed" },
    ...(await managedDropIns(run)).map((path) => ({ path, layer: "managed" as const })),
    { path: p.join(userClaudeDir(run), "settings.json"), layer: "user" },
    { path: p.join(claudeDir, "settings.json"), layer: "project" },
  ];
  if (run.repoRoot !== run.folder) {
    candidates.push({
      path: p.join(run.repoRoot, ".claude", "settings.local.json"),
      layer: "local",
    });
  }
  candidates.push({ path: p.join(claudeDir, "settings.local.json"), layer: "local" });

  const out: SettingsEntry[] = [];
  for (const candidate of candidates) {
    const values = await readJsonFile(run, candidate.path);
    if (!values) continue;
    out.push({ path: candidate.path, layer: candidate.layer, values });
  }
  return out;
}

/**
 * `managed-settings.d/*.json` next to the managed settings file. Docs
 * (/managed-settings): merged after `managed-settings.json`, alphabetically;
 * hidden files and non-`.json` files are ignored.
 */
async function managedDropIns(run: ResolveRun): Promise<string[]> {
  const dir = run.p.join(run.p.dirname(run.managedSettingsPath), "managed-settings.d");
  return (await listDir(run, dir))
    .filter((entry) => !entry.isDirectory)
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith(".") && name.toLowerCase().endsWith(".json"))
    .sort()
    .map((name) => run.p.join(dir, name));
}

const PRIORITY: Record<ConfigLayer, number> = {
  managed: 4,
  local: 3,
  project: 2,
  user: 1,
  directory: 0,
};

/**
 * Settings files highest precedence first, for deciding a single value:
 * managed > local > project > user (docs: /settings, "Settings precedence").
 * Within a layer the later-loaded file wins (a later managed drop-in replaces
 * an earlier value; the folder's `settings.local.json` beats the repo root's).
 */
export function settingsByPriority(settings: SettingsEntry[]): SettingsEntry[] {
  return settings
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        PRIORITY[b.entry.layer] - PRIORITY[a.entry.layer] || b.index - a.index,
    )
    .map(({ entry }) => entry);
}

/** `values` at a dotted key path, e.g. `permissions.defaultMode`. */
export function valueAt(values: Record<string, unknown>, keyPath: string): unknown {
  let current: unknown = values;
  for (const part of keyPath.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

export interface EffectiveOptions<T> {
  /** Reads the raw value; `undefined` means "not set here" (wrong type included). */
  parse: (raw: unknown) => T | undefined;
  default: T;
  /** Layers allowed to set the key; others are skipped with a note. Default: all. */
  layers?: readonly ConfigLayer[];
  /** Per-file veto: return a reason to skip a value this file sets. */
  reject?: (value: T, entry: SettingsEntry) => string | undefined;
}

/**
 * The effective value of a single-valued setting: the highest-precedence
 * settings file that sets it wins; the default applies when none does.
 */
export function effectiveSetting<T>(
  settings: SettingsEntry[],
  key: string,
  options: EffectiveOptions<T>,
): EffectiveValue<T> {
  const notes: string[] = [];
  for (const entry of settingsByPriority(settings)) {
    const value = options.parse(valueAt(entry.values, key));
    if (value === undefined) continue;
    if (options.layers && !options.layers.includes(entry.layer)) {
      notes.push(`ignored in ${entry.path} (${entry.layer} settings can't set it)`);
      continue;
    }
    const rejected = options.reject?.(value, entry);
    if (rejected) {
      notes.push(`ignored in ${entry.path}: ${rejected}`);
      continue;
    }
    const out: EffectiveValue<T> = {
      value,
      key,
      source: { path: entry.path, layer: entry.layer },
    };
    if (notes.length > 0) out.note = notes.join("; ");
    return out;
  }
  const out: EffectiveValue<T> = { value: options.default, key };
  if (notes.length > 0) out.note = notes.join("; ");
  return out;
}

export const asBoolean = (raw: unknown): boolean | undefined =>
  typeof raw === "boolean" ? raw : undefined;

export const asString = (raw: unknown): string | undefined =>
  typeof raw === "string" && raw.length > 0 ? raw : undefined;
