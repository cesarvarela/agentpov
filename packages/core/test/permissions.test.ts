import { describe, expect, it } from "vitest";

import {
  resolveContext,
  type ConfigLayer,
  type PermissionRule,
  type ResolvedContext,
} from "../src/index.js";
import { memfs } from "./memfs.js";

const HOME = "/home/dev";
const FOLDER = "/projects/fixtures/permissions";

/**
 * The two fixture repos in `agentpov-fixtures` (`permissions-precedence` and
 * `permissions-globs`), turned into resolver runs over the injectable fs.
 */
function resolve(
  files: Record<string, string>,
  target: string,
  targetKind: "file" | "directory" = "file",
): Promise<ResolvedContext> {
  return resolveContext(FOLDER, target, {
    fs: memfs(files),
    homeDir: HOME,
    platform: "linux",
    targetKind,
  });
}

interface RuleView {
  decision: string;
  layer: ConfigLayer;
  matchesFile: boolean;
  overridden: boolean;
  overriddenBy?: ConfigLayer;
}

/** Looks up one rule by its text and layer, so same-text rules stay distinct. */
function view(
  ctx: ResolvedContext,
  ruleText: string,
  layer?: ConfigLayer,
): RuleView {
  const found = ctx.permissions.filter(
    (rule) => rule.rule === ruleText && (layer === undefined || rule.layer === layer),
  );
  expect(found, `${ruleText} @ ${layer ?? "any layer"}`).toHaveLength(1);
  const rule = found[0] as PermissionRule;
  const out: RuleView = {
    decision: rule.decision,
    layer: rule.layer,
    matchesFile: rule.matchesFile,
    overridden: rule.overridden,
  };
  if (rule.overriddenBy) out.overriddenBy = rule.overriddenBy;
  return out;
}

/** The rule that decides `tool` for the target, mirroring the renderer. */
function verdict(ctx: ResolvedContext, tool: string): string {
  const live = ctx.permissions.filter(
    (rule) => rule.tool === tool && rule.matchesFile && !rule.overridden,
  );
  for (const decision of ["deny", "ask", "allow"]) {
    if (live.some((rule) => rule.decision === decision)) return decision;
  }
  return "ask";
}

describe("permissions precedence (fixture: permissions-precedence)", () => {
  const files = {
    [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
      permissions: {
        allow: ["Bash(npm run build)", "Read(./src/**)", "Read"],
        ask: ["Bash(git push:*)"],
        deny: ["Read(./secrets/**)"],
      },
    }),
    [`${FOLDER}/.claude/settings.local.json`]: JSON.stringify({
      permissions: {
        allow: ["Bash(git push:*)"],
        ask: ["Read(./src/**)"],
        deny: ["Bash(npm run build)", "Read(./src/secret.ts)"],
      },
    }),
    [`${FOLDER}/src/index.ts`]: "",
    [`${FOLDER}/src/secret.ts`]: "",
    [`${FOLDER}/secrets/key.txt`]: "",
  };

  it("lets a local deny beat a project allow for the same rule text", async () => {
    const ctx = await resolve(files, "src/index.ts");

    expect(view(ctx, "Bash(npm run build)", "project")).toMatchObject({
      decision: "allow",
      overridden: true,
      overriddenBy: "local",
    });
    expect(view(ctx, "Bash(npm run build)", "local")).toMatchObject({
      decision: "deny",
      overridden: false,
    });
  });

  it("lets a lower-layer ask beat a higher-layer allow (deny > ask > allow)", async () => {
    const ctx = await resolve(files, "src/index.ts");

    // `Read(./src/**)`: project allow vs local ask — ask wins although it is
    // the lower layer.
    expect(view(ctx, "Read(./src/**)", "local")).toMatchObject({
      decision: "ask",
      matchesFile: true,
      overridden: false,
    });
    expect(view(ctx, "Read(./src/**)", "project")).toMatchObject({
      decision: "allow",
      overridden: true,
      overriddenBy: "local",
    });

    // `Bash(git push:*)`: project ask vs local allow — the local allow loses.
    expect(view(ctx, "Bash(git push:*)", "project")).toMatchObject({
      decision: "ask",
      overridden: false,
    });
    expect(view(ctx, "Bash(git push:*)", "local")).toMatchObject({
      decision: "allow",
      overridden: true,
      overriddenBy: "project",
    });

    expect(verdict(ctx, "Read")).toBe("ask");
  });

  it("relates a bare tool allow to a specifier deny for the same tool", async () => {
    const ctx = await resolve(files, "src/secret.ts");

    expect(view(ctx, "Read(./src/secret.ts)", "local")).toMatchObject({
      decision: "deny",
      matchesFile: true,
      overridden: false,
    });
    // Bare `Read` covers every invocation, so the deny overrides it here.
    expect(view(ctx, "Read", "project")).toMatchObject({
      decision: "allow",
      matchesFile: true,
      overridden: true,
      overriddenBy: "local",
    });
    expect(verdict(ctx, "Read")).toBe("deny");
  });

  it("leaves a bare tool allow live when no stronger rule matches the file", async () => {
    const ctx = await resolve(files, "src/index.ts");

    expect(view(ctx, "Read", "project")).toMatchObject({
      matchesFile: true,
      overridden: true, // the local `ask` for `./src/**` still beats it
      overriddenBy: "local",
    });
    // A rule that does not match the target is neither winning nor overridden.
    expect(view(ctx, "Read(./src/secret.ts)", "local")).toMatchObject({
      matchesFile: false,
      overridden: false,
    });
  });

  it("denies a file the project deny covers even with a bare allow above", async () => {
    const ctx = await resolve(files, "secrets/key.txt");

    expect(view(ctx, "Read(./secrets/**)", "project")).toMatchObject({
      decision: "deny",
      matchesFile: true,
      overridden: false,
    });
    expect(view(ctx, "Read", "project")).toMatchObject({
      matchesFile: true,
      overridden: true,
      overriddenBy: "project",
    });
    expect(verdict(ctx, "Read")).toBe("deny");
  });

  it("matches folder targets by coverage", async () => {
    const secrets = await resolve(files, "secrets", "directory");
    expect(view(secrets, "Read(./secrets/**)", "project").matchesFile).toBe(true);

    const src = await resolve(files, "src", "directory");
    // The specifier covers something inside the folder.
    expect(view(src, "Read(./src/secret.ts)", "local").matchesFile).toBe(true);
    expect(view(src, "Read(./secrets/**)", "project").matchesFile).toBe(false);
  });

  it("never lifts a deny, whatever the layer above says", async () => {
    const ctx = await resolve(
      {
        [`${HOME}/.claude/settings.json`]: JSON.stringify({
          permissions: { deny: ["Read(./src/**)"] },
        }),
        [`${FOLDER}/.claude/settings.local.json`]: JSON.stringify({
          permissions: { allow: ["Read(./src/**)"], ask: ["Read(./src/**)"] },
        }),
      },
      "src/index.ts",
    );

    expect(view(ctx, "Read(./src/**)", "user")).toMatchObject({
      decision: "deny",
      overridden: false,
    });
    expect(
      ctx.permissions
        .filter((rule) => rule.layer === "local")
        .map((rule) => [rule.decision, rule.overridden, rule.overriddenBy]),
    ).toEqual([
      // The allow loses to the ask in its own layer first, then both lose to
      // the user-layer deny; `overriddenBy` names the highest-layer winner.
      ["allow", true, "local"],
      ["ask", true, "user"],
    ]);
  });

  it("leaves two competing rules with the same decision both live", async () => {
    const ctx = await resolve(
      {
        [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
          permissions: { allow: ["Read(./src/**)"] },
        }),
        [`${FOLDER}/.claude/settings.local.json`]: JSON.stringify({
          permissions: { allow: ["Read(./src/**)"] },
        }),
      },
      "src/index.ts",
    );

    expect(ctx.permissions.every((rule) => !rule.overridden)).toBe(true);
  });

  it("keeps a managed rule winning and marks what it overrides", async () => {
    const ctx = await resolve(
      {
        "/etc/claude-code/managed-settings.json": JSON.stringify({
          permissions: { deny: ["Read(./src/**)"] },
        }),
        [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
          permissions: { allow: ["Read(./src/**)"] },
        }),
      },
      "src/index.ts",
    );

    expect(view(ctx, "Read(./src/**)", "managed")).toMatchObject({
      decision: "deny",
      overridden: false,
    });
    expect(view(ctx, "Read(./src/**)", "project")).toMatchObject({
      overridden: true,
      overriddenBy: "managed",
    });
  });
});

describe("permission globs (fixture: permissions-globs)", () => {
  const settings = JSON.stringify({
    permissions: {
      allow: [
        "Read(./src/**)",
        "Bash(npm run *)",
        `Read(~/projects/permissions-globs/README.md)`,
      ],
      ask: ["Read(/docs/**)"],
      deny: [
        "Edit(./src/generated/*)",
        "Read(*.env)",
        // Double slash: `/` + an absolute path.
        `Read(/${FOLDER}/docs/private.md)`,
        "Read(~/.ssh/**)",
      ],
    },
  });

  const files = {
    [`${FOLDER}/.claude/settings.json`]: settings,
    [`${FOLDER}/src/a.ts`]: "",
    [`${FOLDER}/src/generated/a.ts`]: "",
    [`${FOLDER}/src/generated/nested/b.ts`]: "",
    [`${FOLDER}/docs/public.md`]: "",
    [`${FOLDER}/docs/private.md`]: "",
    [`${FOLDER}/.env`]: "",
    [`${FOLDER}/prod.env`]: "",
    [`${FOLDER}/README.md`]: "",
  };

  const matches = async (
    ruleText: string,
    target: string,
    kind: "file" | "directory" = "file",
  ): Promise<boolean> => {
    const ctx = await resolve(files, target, kind);
    return view(ctx, ruleText).matchesFile;
  };

  it("matches `./src/**` at any depth below src", async () => {
    expect(await matches("Read(./src/**)", "src/a.ts")).toBe(true);
    expect(await matches("Read(./src/**)", "src/generated/nested/b.ts")).toBe(true);
    expect(await matches("Read(./src/**)", "README.md")).toBe(false);
  });

  it("keeps a single `*` from crossing a slash", async () => {
    expect(await matches("Edit(./src/generated/*)", "src/generated/a.ts")).toBe(true);
    expect(await matches("Edit(./src/generated/*)", "src/generated/nested/b.ts")).toBe(
      false,
    );
    // Folder targets ask "could this cover anything inside?".
    expect(
      await matches("Edit(./src/generated/*)", "src/generated", "directory"),
    ).toBe(true);
    expect(await matches("Edit(./src/generated/*)", "src", "directory")).toBe(true);
  });

  // Docs (/permissions, "Read and Edit"): bare filenames follow gitignore and
  // match at any depth — `Read(*.env)` blocks every `*.env` at any depth. This
  // used to assert the pattern stayed at the root.
  it("matches a slash-less `*.env` pattern at any depth", async () => {
    expect(await matches("Read(*.env)", ".env")).toBe(true);
    expect(await matches("Read(*.env)", "prod.env")).toBe(true);
    expect(await matches("Read(*.env)", "src/.env")).toBe(true);
    expect(await matches("Read(*.env)", "src/a.ts")).toBe(false);
  });

  it("reads `//path` as filesystem-absolute", async () => {
    const rule = `Read(/${FOLDER}/docs/private.md)`;
    expect(await matches(rule, "docs/private.md")).toBe(true);
    expect(await matches(rule, "docs/public.md")).toBe(false);
  });

  it("expands `~/` against the home directory", async () => {
    expect(
      await matches("Read(~/projects/permissions-globs/README.md)", "README.md"),
    ).toBe(false);
    expect(await matches("Read(~/.ssh/**)", "README.md")).toBe(false);

    // Same rule, resolved inside the home directory: now it hits.
    const ctx = await resolveContext(
      `${HOME}/projects/permissions-globs`,
      "README.md",
      {
        fs: memfs({
          [`${HOME}/projects/permissions-globs/.claude/settings.json`]: settings,
        }),
        homeDir: HOME,
        platform: "linux",
      },
    );
    expect(view(ctx, "Read(~/projects/permissions-globs/README.md)").matchesFile).toBe(
      true,
    );
  });

  it("never matches a file target with a non-path tool", async () => {
    expect(await matches("Bash(npm run *)", "src/a.ts")).toBe(false);
    expect(await matches("Bash(npm run *)", ".", "directory")).toBe(false);
  });

  it("keeps both prefix-style and colon-style Bash specifiers parsed", async () => {
    const ctx = await resolve(
      {
        [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
          permissions: { allow: ["Bash(npm run *)", "Bash(npm run:*)"] },
        }),
      },
      "src/a.ts",
    );

    expect(ctx.permissions.map((rule) => rule.specifier)).toEqual([
      "npm run *",
      "npm run:*",
    ]);
    expect(ctx.permissions.every((rule) => rule.tool === "Bash")).toBe(true);
  });
});

describe("single-slash specifier anchoring", () => {
  const rules = JSON.stringify({ permissions: { ask: ["Read(/docs/**)"] } });

  it("anchors a project rule at the project root", async () => {
    const ctx = await resolve(
      { [`${FOLDER}/.claude/settings.json`]: rules },
      "docs/public.md",
    );
    expect(view(ctx, "Read(/docs/**)", "project").matchesFile).toBe(true);
  });

  it("anchors a local rule at the project root", async () => {
    const ctx = await resolve(
      { [`${FOLDER}/.claude/settings.local.json`]: rules },
      "docs/public.md",
    );
    expect(view(ctx, "Read(/docs/**)", "local").matchesFile).toBe(true);
  });

  it("anchors a user rule at ~/.claude", async () => {
    const files = { [`${HOME}/.claude/settings.json`]: rules };

    // A project file under `<project>/docs` is NOT covered by a user-layer
    // `/docs/**`, which means `~/.claude/docs/**`.
    const inProject = await resolve(files, "docs/public.md");
    expect(view(inProject, "Read(/docs/**)", "user").matchesFile).toBe(false);

    const inUserDir = await resolveContext(HOME, ".claude/docs/guide.md", {
      fs: memfs(files),
      homeDir: HOME,
      platform: "linux",
    });
    expect(view(inUserDir, "Read(/docs/**)", "user").matchesFile).toBe(true);
  });

  it("anchors a managed rule at the managed settings directory", async () => {
    const files = { "/etc/claude-code/managed-settings.json": rules };

    const inProject = await resolve(files, "docs/public.md");
    expect(view(inProject, "Read(/docs/**)", "managed").matchesFile).toBe(false);

    const inManagedDir = await resolveContext("/etc/claude-code", "docs/policy.md", {
      fs: memfs(files),
      homeDir: HOME,
      platform: "linux",
    });
    expect(view(inManagedDir, "Read(/docs/**)", "managed").matchesFile).toBe(true);
  });
});

describe("gitignore-style depth for deny and ask", () => {
  const files = (decision: "deny" | "ask" | "allow", specifier: string) => ({
    [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
      permissions: { [decision]: [`Read(${specifier})`] },
    }),
  });

  it("matches a bare single-segment directory pattern at any depth", async () => {
    const deep = await resolve(files("deny", "secrets/**"), "src/secrets/key.txt");
    expect(view(deep, "Read(secrets/**)").matchesFile).toBe(true);

    const root = await resolve(files("deny", "secrets/**"), "secrets/key.txt");
    expect(view(root, "Read(secrets/**)").matchesFile).toBe(true);

    const ask = await resolve(files("ask", "secrets/**"), "src/secrets/key.txt");
    expect(view(ask, "Read(secrets/**)").matchesFile).toBe(true);
  });

  it("keeps an allow rule anchored at the root", async () => {
    const deep = await resolve(files("allow", "secrets/**"), "src/secrets/key.txt");
    expect(view(deep, "Read(secrets/**)").matchesFile).toBe(false);

    const root = await resolve(files("allow", "secrets/**"), "secrets/key.txt");
    expect(view(root, "Read(secrets/**)").matchesFile).toBe(true);
  });

  it("keeps `./secrets/**` and multi-segment patterns anchored", async () => {
    const explicit = await resolve(files("deny", "./secrets/**"), "src/secrets/key.txt");
    expect(view(explicit, "Read(./secrets/**)").matchesFile).toBe(false);

    const multi = await resolve(files("deny", "src/web/**"), "src/api/a.ts");
    expect(view(multi, "Read(src/web/**)").matchesFile).toBe(false);
  });
});

describe("bare names match at any depth (gitignore)", () => {
  const files = (decision: "deny" | "allow", specifier: string) => ({
    [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
      permissions: { [decision]: [`Read(${specifier})`] },
    }),
  });

  it("treats `.env` like `**/.env` in allow and deny rules", async () => {
    for (const decision of ["deny", "allow"] as const) {
      const deep = await resolve(files(decision, ".env"), "src/api/.env");
      expect(view(deep, "Read(.env)").matchesFile, decision).toBe(true);
    }
    const anchored = await resolve(files("deny", "./.env"), "src/api/.env");
    expect(view(anchored, "Read(./.env)").matchesFile).toBe(false);
  });

  it("lets a wildcard-free name cover a directory of that name", async () => {
    const ctx = await resolve(files("deny", "secrets"), "lib/secrets/key.pem");
    expect(view(ctx, "Read(secrets)").matchesFile).toBe(true);
  });
});

describe("gitignore negation (`!`) in deny and ask lists", () => {
  const files = (deny: string[]) => ({
    [`${FOLDER}/.claude/settings.json`]: JSON.stringify({ permissions: { deny } }),
  });

  it("carves a file out of the earlier rules in the same list", async () => {
    const sample = await resolve(files(["Read(*.env)", "Read(!sample.env)"]), "src/sample.env");
    const carved = sample.permissions.find((rule) => rule.rule === "Read(*.env)")!;
    expect(carved).toMatchObject({ matchesFile: false, carvedOutBy: "Read(!sample.env)" });
    // The negation itself denies nothing.
    expect(view(sample, "Read(!sample.env)").matchesFile).toBe(false);

    const prod = await resolve(files(["Read(*.env)", "Read(!sample.env)"]), "prod.env");
    expect(view(prod, "Read(*.env)").matchesFile).toBe(true);
  });

  it("carves nothing when listed first", async () => {
    const ctx = await resolve(files(["Read(!sample.env)", "Read(*.env)"]), "sample.env");
    expect(view(ctx, "Read(*.env)").matchesFile).toBe(true);
  });

  it("can't reopen a file inside a directory blocked as a whole", async () => {
    const ctx = await resolve(
      files(["Read(secrets/**)", "Read(!secrets/public/**)"]),
      "secrets/public/a.txt",
    );
    expect(view(ctx, "Read(secrets/**)").matchesFile).toBe(true);
  });

  it("can't reach a rule anchored with `~/`, `/` or `//`, or another file's rules", async () => {
    const anchored = await resolve(
      files([`Read(//${FOLDER.slice(1)}/**/*.env)`, "Read(!sample.env)"]),
      "sample.env",
    );
    expect(anchored.permissions[0]?.matchesFile).toBe(true);

    const otherFile = await resolve(
      {
        [`${HOME}/.claude/settings.json`]: JSON.stringify({ permissions: { deny: ["Read(*.env)"] } }),
        [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
          permissions: { deny: ["Read(!sample.env)"] },
        }),
      },
      "sample.env",
    );
    expect(view(otherFile, "Read(*.env)").matchesFile).toBe(true);
  });
});

describe("rules Claude Code drops", () => {
  it("ignores non-managed rules under allowManagedPermissionRulesOnly", async () => {
    const ctx = await resolve(
      {
        "/etc/claude-code/managed-settings.json": JSON.stringify({
          allowManagedPermissionRulesOnly: true,
          permissions: { allow: ["Read(./src/**)"] },
        }),
        [`${HOME}/.claude/settings.json`]: JSON.stringify({
          permissions: { deny: ["Read(./src/**)"] },
        }),
      },
      "src/index.ts",
    );
    const user = ctx.permissions.find((rule) => rule.layer === "user")!;
    expect(user.ignored).toMatch(/allowManagedPermissionRulesOnly/);
    // Still computed, so the UI can say it would have matched.
    expect(user.matchesFile).toBe(true);
    expect(user.overridden).toBe(false);
    // The ignored deny doesn't beat the managed allow.
    expect(view(ctx, "Read(./src/**)", "managed")).toMatchObject({ overridden: false });
    expect(ctx.permissions.find((rule) => rule.layer === "managed")?.ignored).toBeUndefined();
  });

  it("ignores the lock outside managed settings", async () => {
    const ctx = await resolve(
      {
        [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
          allowManagedPermissionRulesOnly: true,
          permissions: { deny: ["Read(./src/**)"] },
        }),
      },
      "src/index.ts",
    );
    expect(ctx.permissions[0]?.ignored).toBeUndefined();
  });

  it("ignores path rules for Write, NotebookEdit, MultiEdit and Glob, but not bare names", async () => {
    const ctx = await resolve(
      {
        [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
          permissions: {
            allow: ["Edit(./src/**)"],
            deny: ["Write(./src/**)", "NotebookEdit(./src/**)", "MultiEdit(./src/**)", "Glob(./src/**)", "Write"],
          },
        }),
      },
      "src/index.ts",
    );
    for (const text of ["Write(./src/**)", "NotebookEdit(./src/**)", "MultiEdit(./src/**)", "Glob(./src/**)"]) {
      expect(ctx.permissions.find((rule) => rule.rule === text)?.ignored, text).toMatch(
        /never consults/,
      );
    }
    expect(ctx.permissions.find((rule) => rule.rule === "Write")?.ignored).toBeUndefined();
    // The ignored `Write(./src/**)` deny doesn't override anything.
    expect(view(ctx, "Edit(./src/**)")).toMatchObject({ overridden: false });
  });
});

describe("a Read deny also blocks Edit and Write", () => {
  it("overrides an Edit allow on the same path", async () => {
    const ctx = await resolve(
      {
        [`${FOLDER}/.claude/settings.json`]: JSON.stringify({
          permissions: { allow: ["Edit(./src/**)", "Edit(./docs/**)"], deny: ["Read(./src/secret.ts)"] },
        }),
      },
      "src/secret.ts",
    );
    expect(view(ctx, "Edit(./src/**)")).toMatchObject({ overridden: true, overriddenBy: "project" });
    expect(view(ctx, "Edit(./docs/**)")).toMatchObject({ overridden: false });
  });
});

describe("managed `/path` anchor", () => {
  it("anchors at the directory of the managed settings file in use", async () => {
    const ctx = await resolveContext("/opt/policy", "docs/a.md", {
      fs: memfs({
        "/opt/policy/managed-settings.json": JSON.stringify({
          permissions: { deny: ["Read(/docs/**)"] },
        }),
      }),
      homeDir: HOME,
      platform: "linux",
      managedSettingsPath: "/opt/policy/managed-settings.json",
    });
    expect(view(ctx, "Read(/docs/**)", "managed").matchesFile).toBe(true);
  });
});
