import { describe, expect, it } from "vitest";

import { locateRepository, type ResolveRun } from "../src/context.js";
import { collectEffective } from "../src/effective.js";
import { pathFor } from "../src/paths.js";
import { collectPlugins } from "../src/plugins.js";
import { collectSettings } from "../src/settings.js";
import { collectWorkflows, parseWorkflowMeta } from "../src/workflows.js";
import { memfs } from "./memfs.js";

const HOME = "/home/dev";
const MANAGED = "/etc/claude-code";
const REPO = "/repo";
const FOLDER = "/repo/apps/web";
const PLUGIN = "/opt/plugins/acme";

/** Runs the settings → effective → plugins → workflows part of `resolveContext`. */
async function workflows(files: Record<string, string>, options: { configDir?: string } = {}) {
  const fs = memfs({ [`${REPO}/.git/HEAD`]: "ref: refs/heads/main", ...files });
  const p = pathFor("linux");
  const repository = await locateRepository(fs, p, FOLDER);
  const run: ResolveRun = {
    fs,
    p,
    platform: "linux",
    homeDir: HOME,
    ...(options.configDir ? { configDir: options.configDir } : {}),
    folder: FOLDER,
    file: `${FOLDER}/src/index.ts`,
    targetKind: "file",
    managedDir: MANAGED,
    managedSettingsPath: `${MANAGED}/managed-settings.json`,
    gitRoot: repository.gitRoot,
    repoRoot: repository.repoRoot,
    diagnostics: [],
  };
  const settings = await collectSettings(run);
  const plugins = await collectPlugins(run, settings);
  return collectWorkflows(run, plugins, collectEffective(settings));
}

function acme(manifest: Record<string, unknown> = {}): Record<string, string> {
  return {
    [`${HOME}/.claude/plugins/installed_plugins.json`]: JSON.stringify({
      version: 2,
      plugins: { "acme@corp": [{ scope: "user", installPath: PLUGIN }] },
    }),
    [`${PLUGIN}/.claude-plugin/plugin.json`]: JSON.stringify({ name: "acme", ...manifest }),
  };
}

const script = (name: string, description = `${name} workflow`): string =>
  `export const meta = {\n  name: '${name}',\n  description: '${description}',\n}\n\nreturn await agent('go')\n`;

describe("parseWorkflowMeta", () => {
  it("reads name and description from the documented shape", () => {
    expect(parseWorkflowMeta(script("audit-routes", "Audit every route"))).toEqual({
      name: "audit-routes",
      description: "Audit every route",
    });
  });

  it("tolerates comments, quoted keys, escapes and nested values", () => {
    const source = [
      "#!/usr/bin/env node",
      "// Saved by Claude Code",
      "/* block */",
      "export const meta = {",
      "  phases: [{ name: 'not-this', title: 'Scan' }],",
      '  "name": "release-audit", // trailing comment',
      "  description: `It\\'s a \"check\"`,",
      "  retries: 3,",
      "}",
      "const name = 'body'",
    ].join("\n");
    expect(parseWorkflowMeta(source)).toEqual({
      name: "release-audit",
      description: "It's a \"check\"",
    });
  });

  it("skips values that aren't literals", () => {
    expect(parseWorkflowMeta("export const meta = { name: NAME, description: `a ${b}` }")).toEqual({});
  });

  it("returns undefined when meta isn't the first statement", () => {
    expect(parseWorkflowMeta("const x = 1\nexport const meta = { name: 'late' }")).toBeUndefined();
    expect(parseWorkflowMeta("await agent('no meta')")).toBeUndefined();
  });
});

describe("saved workflows", () => {
  it("finds personal, project (up to the repo root) and plugin workflows", async () => {
    const result = await workflows({
      ...acme(),
      [`${HOME}/.claude/workflows/mine.js`]: script("mine"),
      [`${FOLDER}/.claude/workflows/web.js`]: script("web-check"),
      [`${REPO}/.claude/workflows/root.js`]: "await agent('no meta block')",
      [`${REPO}/.claude/workflows/notes.md`]: "Not a workflow.",
      ["/.claude/workflows/outside.js"]: script("outside"),
      [`${PLUGIN}/workflows/release.js`]: script("release-audit"),
    });

    expect(result.map((w) => [w.name, w.layer, w.plugin, w.description])).toEqual([
      ["mine", "user", undefined, "mine workflow"],
      ["web-check", "project", undefined, "web-check workflow"],
      // No meta: named after the file.
      ["root", "project", undefined, undefined],
      ["acme:release-audit", "user", "acme", "release-audit workflow"],
    ]);
    expect(result.every((w) => w.disabled === undefined && w.shadowedBy === undefined)).toBe(true);
  });

  it("reads personal workflows from CLAUDE_CONFIG_DIR when set", async () => {
    const result = await workflows(
      { ["/cfg/workflows/mine.js"]: script("mine"), [`${HOME}/.claude/workflows/old.js`]: script("old") },
      { configDir: "/cfg" },
    );
    expect(result.map((w) => w.path)).toEqual(["/cfg/workflows/mine.js"]);
  });

  it("runs the closest project workflow, and project over personal", async () => {
    const closest = `${FOLDER}/.claude/workflows/check.js`;
    const result = await workflows({
      [`${HOME}/.claude/workflows/check.js`]: script("check"),
      [`${REPO}/.claude/workflows/check.js`]: script("check"),
      [closest]: script("check"),
    });
    expect(result.map((w) => [w.path, w.shadowedBy?.path])).toEqual([
      [`${HOME}/.claude/workflows/check.js`, closest],
      [closest, undefined],
      [`${REPO}/.claude/workflows/check.js`, closest],
    ]);
  });

  it("replaces the default workflows/ scan with the manifest paths", async () => {
    const result = await workflows({
      ...acme({ workflows: ["./flows/", "./single.js"] }),
      [`${PLUGIN}/workflows/ignored.js`]: script("ignored"),
      [`${PLUGIN}/flows/a.js`]: script("a"),
      [`${PLUGIN}/single.js`]: script("single"),
    });
    expect(result.map((w) => w.name)).toEqual(["acme:a", "acme:single"]);
  });

  it("marks every workflow disabled when disableWorkflows is set", async () => {
    const managed = `${MANAGED}/managed-settings.json`;
    const result = await workflows({
      [managed]: JSON.stringify({ disableWorkflows: true }),
      [`${FOLDER}/.claude/workflows/web.js`]: script("web"),
      [`${HOME}/.claude/workflows/mine.js`]: script("mine"),
    });
    expect(result).toHaveLength(2);
    for (const workflow of result) {
      expect(workflow.disabled).toContain("disableWorkflows");
      expect(workflow.disabled).toContain(managed);
    }
  });
});
