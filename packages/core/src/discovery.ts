import {
  listDir,
  projectClaudeDir,
  readText,
  userClaudeDir,
  type ResolveRun,
} from "./context.js";
import { parseFrontmatter } from "./frontmatter.js";
import { isRecord } from "./json.js";
import { readJsonFile } from "./settings.js";
import {
  type AgentEntry,
  type ConfigLayer,
  type McpServerEntry,
  type SkillEntry,
} from "./types.js";

async function collectSkillsFrom(
  run: ResolveRun,
  root: string,
  layer: ConfigLayer,
): Promise<SkillEntry[]> {
  const out: SkillEntry[] = [];
  const dirs = (await listDir(run, root))
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .sort();

  for (const dirName of dirs) {
    const path = run.p.join(root, dirName, "SKILL.md");
    const content = await readText(run, path);
    if (content === null) continue;
    const frontmatter = parseFrontmatter(content);
    const entry: SkillEntry = {
      path,
      layer,
      name: frontmatter["name"] ?? dirName,
    };
    const description = frontmatter["description"];
    if (description) entry.description = description;
    out.push(entry);
  }
  return out;
}

/** Skills from `~/.claude/skills` then `<folder>/.claude/skills`. */
export async function collectSkills(run: ResolveRun): Promise<SkillEntry[]> {
  return [
    ...(await collectSkillsFrom(run, run.p.join(userClaudeDir(run), "skills"), "user")),
    ...(await collectSkillsFrom(
      run,
      run.p.join(projectClaudeDir(run), "skills"),
      "project",
    )),
  ];
}

async function collectAgentsFrom(
  run: ResolveRun,
  root: string,
  layer: ConfigLayer,
): Promise<AgentEntry[]> {
  const out: AgentEntry[] = [];
  const files = (await listDir(run, root))
    .filter((entry) => !entry.isDirectory && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  for (const fileName of files) {
    const path = run.p.join(root, fileName);
    const content = await readText(run, path);
    if (content === null) continue;
    const frontmatter = parseFrontmatter(content);
    const entry: AgentEntry = {
      path,
      layer,
      name: frontmatter["name"] ?? fileName.replace(/\.md$/i, ""),
    };
    const description = frontmatter["description"];
    if (description) entry.description = description;
    out.push(entry);
  }
  return out;
}

/** Subagents from `~/.claude/agents` then `<folder>/.claude/agents`. */
export async function collectAgents(run: ResolveRun): Promise<AgentEntry[]> {
  return [
    ...(await collectAgentsFrom(run, run.p.join(userClaudeDir(run), "agents"), "user")),
    ...(await collectAgentsFrom(
      run,
      run.p.join(projectClaudeDir(run), "agents"),
      "project",
    )),
  ];
}

function readServerMap(
  value: unknown,
  path: string,
  layer: ConfigLayer,
): McpServerEntry[] {
  if (!isRecord(value)) return [];
  const out: McpServerEntry[] = [];
  for (const name of Object.keys(value).sort()) {
    const config = value[name];
    const entry: McpServerEntry = { path, layer, name, transport: "unknown" };
    if (isRecord(config)) {
      const type = config["type"];
      const url = config["url"];
      const command = config["command"];
      if (type === "http" || type === "sse") entry.transport = type;
      else if (typeof url === "string") entry.transport = "http";
      else if (type === "stdio" || typeof command === "string") entry.transport = "stdio";

      if (typeof url === "string") {
        entry.target = url;
      } else if (typeof command === "string") {
        const args = Array.isArray(config["args"])
          ? config["args"].filter((a): a is string => typeof a === "string")
          : [];
        entry.target = [command, ...args].join(" ");
      }
    }
    out.push(entry);
  }
  return out;
}

/** MCP servers from `~/.claude.json` (user + per-project) and `<folder>/.mcp.json`. */
export async function collectMcpServers(run: ResolveRun): Promise<McpServerEntry[]> {
  const out: McpServerEntry[] = [];

  const userConfigPath = run.p.join(run.homeDir, ".claude.json");
  const userConfig = await readJsonFile(run, userConfigPath);
  if (userConfig) {
    out.push(...readServerMap(userConfig["mcpServers"], userConfigPath, "user"));
  }

  const projectConfigPath = run.p.join(run.folder, ".mcp.json");
  const projectConfig = await readJsonFile(run, projectConfigPath);
  if (projectConfig) {
    out.push(...readServerMap(projectConfig["mcpServers"], projectConfigPath, "project"));
  }

  if (userConfig) {
    const projects = userConfig["projects"];
    if (isRecord(projects)) {
      const scoped = projects[run.folder];
      if (isRecord(scoped)) {
        out.push(...readServerMap(scoped["mcpServers"], userConfigPath, "local"));
      }
    }
  }

  return out;
}
