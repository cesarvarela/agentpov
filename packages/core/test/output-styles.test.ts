import { describe, expect, it } from "vitest";

import { locateRepository, type ResolveRun } from "../src/context.js";
import { collectEffective } from "../src/effective.js";
import { collectOutputStyles } from "../src/output-styles.js";
import { pathFor } from "../src/paths.js";
import { collectPlugins } from "../src/plugins.js";
import { collectSettings } from "../src/settings.js";
import { memfs } from "./memfs.js";

const HOME = "/home/dev";
const MANAGED = "/etc/claude-code";
const REPO = "/repo";
const FOLDER = "/repo/apps/web";
const PLUGIN = "/opt/plugins/acme";

/** Runs the settings → effective → plugins → output styles part of `resolveContext`. */
async function styles(files: Record<string, string>, folder = FOLDER) {
  const fs = memfs({ [`${REPO}/.git/HEAD`]: "ref: refs/heads/main", ...files });
  const p = pathFor("linux");
  const repository = await locateRepository(fs, p, folder);
  const run: ResolveRun = {
    fs,
    p,
    platform: "linux",
    homeDir: HOME,
    folder,
    file: `${folder}/src/index.ts`,
    targetKind: "file",
    managedDir: MANAGED,
    managedSettingsPath: `${MANAGED}/managed-settings.json`,
    gitRoot: repository.gitRoot,
    repoRoot: repository.repoRoot,
    diagnostics: [],
  };
  const settings = await collectSettings(run);
  const plugins = await collectPlugins(run, settings);
  return collectOutputStyles(run, plugins, collectEffective(settings));
}

function plugin(id: string, name: string, root: string, manifest: Record<string, unknown> = {}) {
  return {
    [`${root}/.claude-plugin/plugin.json`]: JSON.stringify({ name, ...manifest }),
    id,
    root,
  };
}

/** `installed_plugins.json` for the given plugins, in order, plus their manifests. */
function installed(...plugins: ReturnType<typeof plugin>[]): Record<string, string> {
  const files: Record<string, string> = {};
  const records: Record<string, unknown> = {};
  for (const { id, root, ...rest } of plugins) {
    Object.assign(files, rest);
    records[id] = [{ scope: "user", installPath: root }];
  }
  files[`${HOME}/.claude/plugins/installed_plugins.json`] = JSON.stringify({ version: 2, plugins: records });
  return files;
}

const outputStyle = (settingsPath: string, value: string): Record<string, string> => ({
  [settingsPath]: JSON.stringify({ outputStyle: value }),
});

describe("output styles", () => {
  it("finds managed, user, project (up to the repo root) and plugin styles", async () => {
    const result = await styles({
      ...installed(plugin("acme@corp", "acme", PLUGIN)),
      [`${MANAGED}/.claude/output-styles/policy.md`]: "---\ndescription: Org style\n---\n",
      [`${HOME}/.claude/output-styles/mine.md`]:
        "---\nname: Diagrams first\nkeep-coding-instructions: true\n---\nUse diagrams.",
      [`${FOLDER}/.claude/output-styles/web.md`]: "Web.",
      [`${REPO}/.claude/output-styles/root.md`]: "Root.",
      // Above the repository root: not read.
      ["/.claude/output-styles/outside.md"]: "Outside.",
      [`${PLUGIN}/output-styles/terse.md`]: "---\nname: terse\nforce-for-plugin: false\n---\n",
    });

    expect(result.map((s) => [s.name, s.layer, s.plugin])).toEqual([
      ["policy", "managed", undefined],
      ["Diagrams first", "user", undefined],
      ["web", "project", undefined],
      ["root", "project", undefined],
      ["acme:terse", "user", "acme"],
    ]);
    expect(result[0]!.description).toBe("Org style");
    expect(result[1]!.keepCodingInstructions).toBe(true);
    expect(result[4]!.forceForPlugin).toBe(false);
    expect(result.every((s) => !s.active)).toBe(true);
  });

  it("reads force-for-plugin only on plugin styles", async () => {
    const [style] = await styles({
      [`${HOME}/.claude/output-styles/mine.md`]: "---\nforce-for-plugin: true\n---\n",
    });
    expect(style!.forceForPlugin).toBeUndefined();
    expect(style!.active).toBe(false);
  });

  it("marks the style outputStyle names, case-sensitively", async () => {
    const files = {
      [`${HOME}/.claude/output-styles/mine.md`]: "---\nname: Diagrams first\n---\n",
    };
    const exact = await styles({
      ...files,
      ...outputStyle(`${FOLDER}/.claude/settings.local.json`, "Diagrams first"),
    });
    expect(exact[0]!.active).toBe(true);

    const wrongCase = await styles({
      ...files,
      ...outputStyle(`${FOLDER}/.claude/settings.local.json`, "diagrams first"),
    });
    expect(wrongCase[0]!.active).toBe(false);
  });

  it("uses the project style closest to the folder, then project over user, managed over all", async () => {
    const closest = `${FOLDER}/.claude/output-styles/house.md`;
    const result = await styles({
      [`${HOME}/.claude/output-styles/house.md`]: "User.",
      [`${REPO}/.claude/output-styles/house.md`]: "Root.",
      [closest]: "Closest.",
      ...outputStyle(`${HOME}/.claude/settings.json`, "house"),
    });

    expect(result.map((s) => [s.path, s.shadowedBy?.path, s.active])).toEqual([
      [`${HOME}/.claude/output-styles/house.md`, closest, false],
      [closest, undefined, true],
      [`${REPO}/.claude/output-styles/house.md`, closest, false],
    ]);

    const managedPath = `${MANAGED}/.claude/output-styles/house.md`;
    const withManaged = await styles({
      [managedPath]: "Managed.",
      [closest]: "Closest.",
      ...outputStyle(`${HOME}/.claude/settings.json`, "house"),
    });
    expect(withManaged.map((s) => [s.layer, s.shadowedBy?.layer, s.active])).toEqual([
      ["managed", undefined, true],
      ["project", "managed", false],
    ]);
  });

  it("lets the first loaded force-for-plugin style override outputStyle", async () => {
    const result = await styles({
      ...installed(
        plugin("alpha@corp", "alpha", "/opt/plugins/alpha"),
        plugin("beta@corp", "beta", "/opt/plugins/beta"),
      ),
      ["/opt/plugins/alpha/output-styles/loud.md"]: "---\nforce-for-plugin: true\n---\n",
      ["/opt/plugins/beta/output-styles/quiet.md"]: "---\nforce-for-plugin: true\n---\n",
      [`${HOME}/.claude/output-styles/mine.md`]: "Mine.",
      ...outputStyle(`${HOME}/.claude/settings.json`, "mine"),
    });
    expect(result.filter((s) => s.active).map((s) => s.name)).toEqual(["alpha:loud"]);
  });

  it("replaces the default output-styles/ scan with the manifest paths", async () => {
    const result = await styles({
      ...installed(plugin("acme@corp", "acme", PLUGIN, { outputStyles: ["./styles/", "./one.md"] })),
      [`${PLUGIN}/output-styles/ignored.md`]: "Ignored.",
      [`${PLUGIN}/styles/a.md`]: "A.",
      [`${PLUGIN}/one.md`]: "---\nname: acme:one\n---\n",
      ...outputStyle(`${HOME}/.claude/settings.json`, "acme:a"),
    });
    expect(result.map((s) => [s.name, s.active])).toEqual([
      ["acme:a", true],
      ["acme:one", false],
    ]);
  });

  it("lists nothing for a built-in style", async () => {
    const result = await styles(outputStyle(`${HOME}/.claude/settings.json`, "Explanatory"));
    expect(result).toEqual([]);
  });
});
