import { describe, expect, it } from "vitest";

import { resolveContext, type MemoryEntry, type ResolvedContext } from "../src/index.js";
import { expandBraces } from "../src/memory.js";
import { parseFrontmatter, parseFrontmatterFields } from "../src/frontmatter.js";
import { memfs } from "./memfs.js";

const HOME = "/home/dev";
const FOLDER = "/projects/acme/shop-api";
const FILE = "src/api/payments.ts";

function run(
  files: Record<string, string>,
  file = FILE,
  folder = FOLDER,
): Promise<ResolvedContext> {
  return resolveContext(folder, file, {
    fs: memfs(files),
    homeDir: HOME,
    platform: "linux",
  });
}

function runDir(
  files: Record<string, string>,
  dir = "src/api",
  folder = FOLDER,
): Promise<ResolvedContext> {
  return resolveContext(folder, dir, {
    fs: memfs(files),
    homeDir: HOME,
    platform: "linux",
    targetKind: "directory",
  });
}

function rules(result: ResolvedContext): MemoryEntry[] {
  return result.memory.filter((entry) => entry.kind === "rule");
}

function frontmatter(lines: string[], body = "rule body"): string {
  return ["---", ...lines, "---", "", body].join("\n");
}

describe(".claude/rules", () => {
  it("loads a rule without paths: at launch, like .claude/CLAUDE.md", async () => {
    const result = await run({
      [`${FOLDER}/.claude/rules/style.md`]: "# Style\n\nUse tabs.",
    });

    expect(rules(result)).toHaveLength(1);
    expect(rules(result)[0]).toMatchObject({
      path: `${FOLDER}/.claude/rules/style.md`,
      kind: "rule",
      layer: "project",
      loading: "always",
      reason: "always loaded",
      scopedToFile: false,
      content: "# Style\n\nUse tabs.",
    });
    expect(rules(result)[0]?.appliesToGlobs).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
  });

  it("finds rules in nested directories, in path order", async () => {
    const result = await run({
      [`${FOLDER}/.claude/rules/zebra.md`]: "z",
      [`${FOLDER}/.claude/rules/api/deep/nested.md`]: "n",
      [`${FOLDER}/.claude/rules/alpha.md`]: "a",
      [`${FOLDER}/.claude/rules/notes.txt`]: "ignored",
    });

    expect(rules(result).map((entry) => entry.path)).toEqual([
      `${FOLDER}/.claude/rules/alpha.md`,
      `${FOLDER}/.claude/rules/api/deep/nested.md`,
      `${FOLDER}/.claude/rules/zebra.md`,
    ]);
  });

  it("loads a paths: rule whose glob matches the file target", async () => {
    const result = await run({
      [`${FOLDER}/.claude/rules/api.md`]: frontmatter([
        "paths:",
        '  - "src/**/*.ts"',
      ]),
    });

    expect(rules(result)).toHaveLength(1);
    expect(rules(result)[0]).toMatchObject({
      path: `${FOLDER}/.claude/rules/api.md`,
      kind: "rule",
      layer: "project",
      loading: "on-read",
      reason: "loaded when Claude reads a file matching src/**/*.ts",
      scopedToFile: true,
      appliesToGlobs: ["src/**/*.ts"],
    });
  });

  it("leaves out a paths: rule whose globs miss the target", async () => {
    const result = await run({
      [`${FOLDER}/.claude/rules/web.md`]: frontmatter([
        "paths:",
        "  - src/web/**",
        "  - docs/*.md",
      ]),
      [`${FOLDER}/.claude/rules/always.md`]: "unconditional",
    });

    expect(rules(result).map((entry) => entry.path)).toEqual([
      `${FOLDER}/.claude/rules/always.md`,
    ]);
  });

  it("reads an inline paths: list", async () => {
    const files = {
      [`${FOLDER}/.claude/rules/inline.md`]: frontmatter([
        'paths: ["src/web/**", "src/api/*.ts"]',
      ]),
    };

    expect(rules(await run(files))).toHaveLength(1);
    expect(rules(await run(files, "src/other/thing.ts"))).toHaveLength(0);
  });

  it("applies a paths: rule to a directory target its glob could reach", async () => {
    const files = {
      [`${FOLDER}/.claude/rules/api.md`]: frontmatter(["paths:", "  - src/api/**/*.ts"]),
    };

    expect(rules(await runDir(files, "src/api")).map((entry) => entry.loading)).toEqual([
      "on-read",
    ]);
    expect(rules(await runDir(files, "src"))).toHaveLength(1);
    expect(rules(await runDir(files, "."))).toHaveLength(1);
    expect(rules(await runDir(files, "docs"))).toHaveLength(0);
  });

  it("expands brace alternatives in a paths: glob", async () => {
    const files = {
      [`${FOLDER}/.claude/rules/ts.md`]: frontmatter([
        "paths:",
        "  - src/**/*.{ts,tsx}",
      ]),
    };

    expect(rules(await run(files, "src/api/payments.ts"))).toHaveLength(1);
    expect(rules(await run(files, "src/web/Page.tsx"))).toHaveLength(1);
    expect(rules(await run(files, "src/web/page.css"))).toHaveLength(0);
    expect(rules(await run(files, "src/api/payments.ts"))[0]?.reason).toBe(
      "loaded when Claude reads a file matching src/**/*.{ts,tsx}",
    );
  });

  it("loads user-level rules from ~/.claude/rules", async () => {
    const result = await run({
      [`${HOME}/.claude/rules/global.md`]: "global rule",
      [`${HOME}/.claude/rules/scoped.md`]: frontmatter(["paths:", "  - src/api/**"]),
      [`${HOME}/.claude/rules/elsewhere.md`]: frontmatter(["paths:", "  - infra/**"]),
    });

    expect(rules(result).map((entry) => [entry.path, entry.layer, entry.loading])).toEqual(
      [
        [`${HOME}/.claude/rules/global.md`, "user", "always"],
        [`${HOME}/.claude/rules/scoped.md`, "user", "on-read"],
      ],
    );
  });

  it("puts user rules before project rules, after each layer's CLAUDE.md", async () => {
    const result = await run({
      [`${HOME}/.claude/CLAUDE.md`]: "user md",
      [`${HOME}/.claude/rules/global.md`]: "user rule",
      [`${FOLDER}/CLAUDE.md`]: "project md",
      [`${FOLDER}/.claude/rules/project.md`]: "project rule",
      [`${FOLDER}/src/api/CLAUDE.md`]: "nested md",
    });

    expect(result.memory.map((entry) => entry.path)).toEqual([
      `${HOME}/.claude/CLAUDE.md`,
      `${HOME}/.claude/rules/global.md`,
      `${FOLDER}/CLAUDE.md`,
      `${FOLDER}/.claude/rules/project.md`,
      `${FOLDER}/src/api/CLAUDE.md`,
    ]);
  });

  it("follows @imports from a rule, inheriting its layer and loading mode", async () => {
    const result = await run({
      [`${FOLDER}/.claude/rules/api.md`]: frontmatter(
        ["paths:", "  - src/api/**"],
        "Follow @../../docs/style.md closely.",
      ),
      [`${FOLDER}/docs/style.md`]: "style rules",
    });

    expect(result.memory.map((entry) => [entry.path, entry.kind, entry.loading])).toEqual([
      [`${FOLDER}/.claude/rules/api.md`, "rule", "on-read"],
      [`${FOLDER}/docs/style.md`, "import", "on-read"],
    ]);
    expect(result.memory[1]).toMatchObject({
      layer: "project",
      importedBy: `${FOLDER}/.claude/rules/api.md`,
      importedAtLine: 6,
      scopedToFile: true,
    });
  });

  it("resolves a slash-free import like @README", async () => {
    const result = await run({
      [`${FOLDER}/.claude/rules/always.md`]: "Read @README first.",
      [`${FOLDER}/.claude/rules/README`]: "readme body",
    });

    // `README` has no `.md` extension, so it is not a rule of its own — it only
    // reaches context as the import.
    expect(result.memory.map((entry) => [entry.path, entry.kind])).toEqual([
      [`${FOLDER}/.claude/rules/always.md`, "rule"],
      [`${FOLDER}/.claude/rules/README`, "import"],
    ]);
  });

  it("follows imports four hops deep and no further", async () => {
    const chain: Record<string, string> = {
      [`${FOLDER}/CLAUDE.md`]: "@a.md",
      [`${FOLDER}/a.md`]: "@b.md",
      [`${FOLDER}/b.md`]: "@c.md",
      [`${FOLDER}/c.md`]: "@d.md",
      [`${FOLDER}/d.md`]: "@e.md",
      [`${FOLDER}/e.md`]: "end",
    };
    const result = await run(chain);

    expect(result.memory.map((entry) => entry.path)).toEqual([
      `${FOLDER}/CLAUDE.md`,
      `${FOLDER}/a.md`,
      `${FOLDER}/b.md`,
      `${FOLDER}/c.md`,
      `${FOLDER}/d.md`,
    ]);
  });
});

describe("expandBraces", () => {
  it("leaves a brace-free pattern alone", () => {
    expect(expandBraces("src/**/*.ts")).toEqual(["src/**/*.ts"]);
  });

  it("expands one group", () => {
    expect(expandBraces("src/**/*.{ts,tsx}")).toEqual(["src/**/*.ts", "src/**/*.tsx"]);
  });

  it("expands nested and multiple groups", () => {
    expect(expandBraces("{a,b}/{c,d}")).toEqual(["a/c", "a/d", "b/c", "b/d"]);
    expect(expandBraces("src/{api,web/{one,two}}/*.ts")).toEqual([
      "src/api/*.ts",
      "src/web/one/*.ts",
      "src/web/two/*.ts",
    ]);
  });

  it("treats an unbalanced brace literally", () => {
    expect(expandBraces("src/{ts")).toEqual(["src/{ts"]);
  });
});

describe("frontmatter lists", () => {
  it("parses block and inline lists without disturbing scalars", () => {
    const fields = parseFrontmatterFields(
      [
        "---",
        "name: my-rule",
        'description: "A rule, with a comma"',
        "paths:",
        "  - src/**/*.ts",
        '  - "docs/**"',
        "tags: [one, two]",
        "---",
        "body",
      ].join("\n"),
    );

    expect(fields).toEqual({
      name: "my-rule",
      description: "A rule, with a comma",
      paths: ["src/**/*.ts", "docs/**"],
      tags: ["one", "two"],
    });
  });

  it("keeps parseFrontmatter scalar-only for skills and agents", () => {
    const content = [
      "---",
      "name: pdf",
      "description: Work with PDFs",
      "allowed-tools:",
      "  - Read",
      "---",
      "body",
    ].join("\n");

    expect(parseFrontmatter(content)).toEqual({
      name: "pdf",
      description: "Work with PDFs",
    });
  });
});
