export * from "./types.js";
export { createNodeFileSystem } from "./node-fs.js";
export { globToRegExp } from "./glob.js";

import { managedDirFor, type ResolveRun } from "./context.js";
import { collectAgents, collectMcpServers, collectSkills } from "./discovery.js";
import { collectHooks } from "./hooks.js";
import { collectMemory } from "./memory.js";
import { pathFor, tidy, toAbsolute } from "./paths.js";
import { collectPermissions } from "./permissions.js";
import { collectSettings, managedSettingsPathFor } from "./settings.js";
import { type ResolvedContext, type ResolveOptions } from "./types.js";

/**
 * Resolve everything a coding agent would see for `target` inside `folder`,
 * where `target` is a single file or a whole directory.
 *
 * Walks the Managed → User → Project → Local → Directory layers: reads every
 * applicable `CLAUDE.md` (following `@path` imports), the user's memory
 * directory, `settings.json` at each layer, the permission rules and hooks
 * those settings register, and the skills, subagents and MCP servers available
 * here. Everything carries the absolute path and layer it came from.
 *
 * All filesystem access goes through `options.fs`; missing files are not
 * errors, they are simply absent (or a `diagnostics` string when something was
 * present but unusable).
 *
 * `target` may be absolute or relative to `folder`; the result always reports
 * it as an absolute path. It is a file by default, or a directory when
 * `options.targetKind` is `"directory"` — then the folder's own `CLAUDE.md`
 * counts and permission rules match when they could cover anything inside it.
 */
export async function resolveContext(
  folder: string,
  target: string,
  options: ResolveOptions,
): Promise<ResolvedContext> {
  const platform = options.platform ?? process.platform;
  const p = pathFor(platform);
  const absoluteFolder = tidy(p, folder);
  const absoluteTarget = toAbsolute(p, absoluteFolder, target);
  const targetKind = options.targetKind ?? "file";

  const run: ResolveRun = {
    fs: options.fs,
    p,
    platform,
    homeDir: tidy(p, options.homeDir),
    folder: absoluteFolder,
    file: absoluteTarget,
    targetKind,
    managedDir: managedDirFor(platform),
    managedSettingsPath:
      options.managedSettingsPath ?? managedSettingsPathFor(platform),
    diagnostics: [],
  };

  const memory = await collectMemory(run);
  const settings = await collectSettings(run);
  const permissions = collectPermissions(run, settings);
  const hooks = collectHooks(settings);
  const skills = await collectSkills(run, settings);
  const agents = await collectAgents(run);
  const mcpServers = await collectMcpServers(run, settings);

  return {
    folder: absoluteFolder,
    file: absoluteTarget,
    targetKind,
    memory,
    settings,
    permissions,
    hooks,
    skills,
    agents,
    mcpServers,
    diagnostics: run.diagnostics,
  };
}
