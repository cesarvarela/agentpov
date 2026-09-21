export * from "./types.js";
export { createNodeFileSystem } from "./node-fs.js";

import { managedDirFor, type ResolveRun } from "./context.js";
import { collectAgents, collectMcpServers, collectSkills } from "./discovery.js";
import { collectHooks } from "./hooks.js";
import { collectMemory } from "./memory.js";
import { pathFor, tidy, toAbsolute } from "./paths.js";
import { collectPermissions } from "./permissions.js";
import { collectSettings, managedSettingsPathFor } from "./settings.js";
import { type ResolvedContext, type ResolveOptions } from "./types.js";

/**
 * Resolve everything a coding agent would see for `file` inside `folder`.
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
 * `file` may be absolute or relative to `folder`; the result always reports it
 * as an absolute path.
 */
export async function resolveContext(
  folder: string,
  file: string,
  options: ResolveOptions,
): Promise<ResolvedContext> {
  const platform = options.platform ?? process.platform;
  const p = pathFor(platform);
  const absoluteFolder = tidy(p, folder);
  const absoluteFile = toAbsolute(p, absoluteFolder, file);

  const run: ResolveRun = {
    fs: options.fs,
    p,
    platform,
    homeDir: tidy(p, options.homeDir),
    folder: absoluteFolder,
    file: absoluteFile,
    managedDir: managedDirFor(platform),
    managedSettingsPath:
      options.managedSettingsPath ?? managedSettingsPathFor(platform),
    diagnostics: [],
  };

  const memory = await collectMemory(run);
  const settings = await collectSettings(run);
  const permissions = collectPermissions(run, settings);
  const hooks = collectHooks(settings);
  const skills = await collectSkills(run);
  const agents = await collectAgents(run);
  const mcpServers = await collectMcpServers(run);

  return {
    folder: absoluteFolder,
    file: absoluteFile,
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
