import {
  managedDirFor,
  projectClaudeDir,
  readText,
  userClaudeDir,
  type ResolveRun,
} from "./context.js";
import { isRecord, parseLenientJson } from "./json.js";
import { type ConfigLayer, type SettingsEntry } from "./types.js";

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

/** Settings files for each layer, lowest precedence first. */
export async function collectSettings(run: ResolveRun): Promise<SettingsEntry[]> {
  const { p } = run;
  const claudeDir = projectClaudeDir(run);
  const candidates: { path: string; layer: ConfigLayer }[] = [
    { path: run.managedSettingsPath, layer: "managed" },
    { path: p.join(userClaudeDir(run), "settings.json"), layer: "user" },
    { path: p.join(claudeDir, "settings.json"), layer: "project" },
    { path: p.join(claudeDir, "settings.local.json"), layer: "local" },
  ];

  const out: SettingsEntry[] = [];
  for (const candidate of candidates) {
    const values = await readJsonFile(run, candidate.path);
    if (!values) continue;
    out.push({ path: candidate.path, layer: candidate.layer, values });
  }
  return out;
}
