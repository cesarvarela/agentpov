export * from "./types.js";

import { type ResolvedContext } from "./types.js";

/**
 * Resolve everything a coding agent would see for `file` inside `folder`.
 *
 * STUB: returns a well-typed empty result. The real implementation will walk
 * the Managed → User → Project → Local → Directory layers, read CLAUDE.md and
 * settings files, merge permission rules, and collect hooks, skills, agents
 * and MCP servers. See ./README.md.
 */
export function resolveContext(folder: string, file: string): ResolvedContext {
  return {
    folder,
    file,
    memory: [],
    settings: [],
    permissions: [],
    hooks: [],
    skills: [],
    agents: [],
    mcpServers: [],
    diagnostics: [],
  };
}
