import {
  listDir,
  projectDirsUpToGitRoot,
  readText,
  userClaudeDir,
  type ResolveRun,
} from "./context.js";
import { boolField, markShadowed } from "./discovery.js";
import { parseFrontmatter } from "./frontmatter.js";
import { enabledPlugins, pluginComponentPaths, type LoadedPlugin } from "./plugins.js";
import {
  type ConfigLayer,
  type EffectiveSettings,
  type OutputStyleEntry,
} from "./types.js";

/**
 * Rank when two output styles share a name. The docs (/output-styles) only say
 * that among nested project `.claude/output-styles/` directories the one
 * closest to the working directory wins; the order across managed, user and
 * project isn't documented. This follows the other surfaces: managed >
 * project (closest first) > user > plugin. Plugin styles are namespaced
 * `<plugin>:<name>`, so in practice they never collide with the others.
 */
const STYLE_RANK = {
  managed: 1000,
  project: 500,
  user: 100,
  plugin: 0,
} as const;

interface StyleScan {
  layer: ConfigLayer;
  rank: number;
  /** For plugin styles: the plugin name (the namespace). */
  plugin?: string;
}

function styleEntry(
  run: ResolveRun,
  scan: StyleScan,
  path: string,
  content: string,
): OutputStyleEntry {
  const frontmatter = parseFrontmatter(content);
  const label = frontmatter["name"] ?? run.p.basename(path).replace(/\.md$/i, "");
  const prefix = scan.plugin ? `${scan.plugin}:` : "";
  const entry: OutputStyleEntry = {
    path,
    layer: scan.layer,
    name: prefix && !label.startsWith(prefix) ? `${prefix}${label}` : label,
    active: false,
  };
  const description = frontmatter["description"];
  if (description) entry.description = description;
  const keep = boolField(frontmatter["keep-coding-instructions"]);
  if (keep !== undefined) entry.keepCodingInstructions = keep;
  if (scan.plugin) {
    entry.plugin = scan.plugin;
    // Docs: `force-for-plugin` is read for plugin output styles only.
    const forced = boolField(frontmatter["force-for-plugin"]);
    if (forced !== undefined) entry.forceForPlugin = forced;
  }
  return entry;
}

/** `*.md` directly inside `dir` (the docs describe a flat folder). */
async function stylesIn(
  run: ResolveRun,
  dir: string,
  scan: StyleScan,
  ranks: Map<OutputStyleEntry, number>,
): Promise<OutputStyleEntry[]> {
  const names = (await listDir(run, dir))
    .filter((entry) => !entry.isDirectory && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  const out: OutputStyleEntry[] = [];
  for (const name of names) {
    const path = run.p.join(dir, name);
    const content = await readText(run, path);
    if (content === null) continue;
    const style = styleEntry(run, scan, path, content);
    ranks.set(style, scan.rank);
    out.push(style);
  }
  return out;
}

/**
 * Output styles from enabled plugins. Docs (/plugins/manifest-reference): the
 * manifest `outputStyles` key **replaces** the default `output-styles/` scan
 * and takes a directory or a file, or an array of them. They appear as
 * `<plugin>:<name>` (/plugins/components#themes-and-output-styles).
 */
async function pluginStyles(
  run: ResolveRun,
  plugins: LoadedPlugin[],
  ranks: Map<OutputStyleEntry, number>,
): Promise<OutputStyleEntry[]> {
  const out: OutputStyleEntry[] = [];
  for (const plugin of enabledPlugins(plugins)) {
    const scan: StyleScan = {
      layer: plugin.entry.layer,
      rank: STYLE_RANK.plugin,
      plugin: plugin.entry.name,
    };
    const seen = new Set<string>();
    for (const path of pluginComponentPaths(run, plugin, "outputStyles", "output-styles", "replaces")) {
      const found: OutputStyleEntry[] = [];
      if ((await run.fs.readDir(path)) !== null) {
        found.push(...(await stylesIn(run, path, scan, ranks)));
      } else if (path.toLowerCase().endsWith(".md")) {
        const content = await readText(run, path);
        if (content === null) continue;
        const style = styleEntry(run, scan, path, content);
        ranks.set(style, scan.rank);
        found.push(style);
      }
      for (const style of found) {
        if (seen.has(style.path)) continue;
        seen.add(style.path);
        out.push(style);
      }
    }
  }
  return out;
}

/**
 * Custom output styles and which one the session uses. Docs (/output-styles,
 * Claude Code 2.1.280):
 *
 * - user `~/.claude/output-styles`, project `.claude/output-styles` in every
 *   directory from the working directory up to the repository root, managed
 *   `.claude/output-styles` inside the managed settings directory, and
 *   enabled plugins' `output-styles/`;
 * - the file name is the style name unless frontmatter `name` sets one;
 * - `outputStyle` matches a style name case-sensitively;
 * - a plugin style with `force-for-plugin: true` applies whenever the plugin
 *   is enabled and overrides `outputStyle`; with several, the first loaded wins.
 *
 * The built-in styles (Default, Proactive, Concise, Explanatory, Learning)
 * aren't files, so they aren't listed; when one of them is selected, no entry
 * here is `active`.
 */
export async function collectOutputStyles(
  run: ResolveRun,
  plugins: LoadedPlugin[],
  effective: EffectiveSettings,
): Promise<OutputStyleEntry[]> {
  const ranks = new Map<OutputStyleEntry, number>();
  const out: OutputStyleEntry[] = [
    ...(await stylesIn(
      run,
      run.p.join(run.managedDir, ".claude", "output-styles"),
      { layer: "managed", rank: STYLE_RANK.managed },
      ranks,
    )),
    ...(await stylesIn(
      run,
      run.p.join(userClaudeDir(run), "output-styles"),
      { layer: "user", rank: STYLE_RANK.user },
      ranks,
    )),
  ];
  for (const [index, dir] of projectDirsUpToGitRoot(run).entries()) {
    out.push(
      ...(await stylesIn(
        run,
        run.p.join(dir, ".claude", "output-styles"),
        { layer: "project", rank: STYLE_RANK.project - index },
        ranks,
      )),
    );
  }
  out.push(...(await pluginStyles(run, plugins, ranks)));

  markShadowed(
    out,
    (entry) => entry.name,
    (entry) => ranks.get(entry) ?? 0,
    (entry, shadowedBy) => {
      entry.shadowedBy = shadowedBy;
    },
  );

  const forced = out.find((entry) => entry.plugin !== undefined && entry.forceForPlugin === true);
  const active =
    forced ??
    out.find((entry) => entry.shadowedBy === undefined && entry.name === effective.outputStyle.value);
  if (active) active.active = true;

  return out;
}
