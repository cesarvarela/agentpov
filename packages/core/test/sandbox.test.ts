import { describe, expect, it } from "vitest";

import {
  resolveContext,
  type ResolvedContext,
  type SandboxPathRule,
} from "../src/index.js";
import { memfs } from "./memfs.js";

const HOME = "/home/dev";
const FOLDER = `${HOME}/work/app`;
const MANAGED = "/etc/claude-code/managed-settings.json";
const USER = `${HOME}/.claude/settings.json`;
const PROJECT = `${FOLDER}/.claude/settings.json`;
const LOCAL = `${FOLDER}/.claude/settings.local.json`;

interface Options {
  targetKind?: "file" | "directory";
  platform?: NodeJS.Platform;
}

function resolve(
  files: Record<string, unknown>,
  target: string,
  options: Options = {},
): Promise<ResolvedContext> {
  const fs: Record<string, string> = {};
  for (const [path, value] of Object.entries(files)) {
    fs[path] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return resolveContext(FOLDER, target, {
    fs: memfs(fs),
    homeDir: HOME,
    platform: options.platform ?? "linux",
    targetKind: options.targetKind ?? "file",
  });
}

const on = (sandbox: Record<string, unknown> = {}) => ({
  sandbox: { enabled: true, ...sandbox },
});

function entry(ctx: ResolvedContext, pattern: string): SandboxPathRule {
  const found = ctx.sandbox.filesystem.filter((rule) => rule.pattern === pattern);
  expect(found, pattern).toHaveLength(1);
  return found[0]!;
}

describe("sandbox switches", () => {
  it("has no target verdict while the sandbox is off", async () => {
    const ctx = await resolve({}, "src/a.ts");
    expect(ctx.sandbox.enabled.value).toBe(false);
    expect(ctx.sandbox.autoAllowBashIfSandboxed.value).toBe(true);
    expect(ctx.sandbox.allowUnsandboxedCommands.value).toBe(true);
    expect(ctx.sandbox.filesystemDisabled.value).toBe(false);
    expect(ctx.sandbox.target).toBeNull();
  });

  it("takes booleans from the highest-precedence file", async () => {
    const ctx = await resolve(
      {
        [MANAGED]: { sandbox: { allowUnsandboxedCommands: false } },
        [USER]: on({ allowUnsandboxedCommands: true }),
        [PROJECT]: { sandbox: { enabled: false } },
        [LOCAL]: on(),
      },
      "src/a.ts",
    );
    expect(ctx.sandbox.enabled).toMatchObject({ value: true, source: { layer: "local" } });
    expect(ctx.sandbox.allowUnsandboxedCommands).toMatchObject({
      value: false,
      source: { layer: "managed" },
    });
  });

  it("never gives a verdict on native Windows", async () => {
    const ctx = await resolveContext("C:\\work\\app", "a.ts", {
      fs: memfs({ "C:\\work\\app\\.claude\\settings.json": JSON.stringify(on()) }),
      homeDir: "C:\\Users\\dev",
      platform: "win32",
    });
    expect(ctx.sandbox.enabled.value).toBe(true);
    expect(ctx.sandbox.enabled.note).toMatch(/native Windows/);
    expect(ctx.sandbox.target).toBeNull();
  });
});

describe("sandbox lists", () => {
  it("concatenates excludedCommands across every file, with provenance", async () => {
    const ctx = await resolve(
      {
        [MANAGED]: { sandbox: { excludedCommands: ["docker *"] } },
        [USER]: { sandbox: { excludedCommands: ["gh *"] } },
        [PROJECT]: { sandbox: { excludedCommands: ["terraform *"] } },
      },
      "src/a.ts",
    );
    expect(ctx.sandbox.excludedCommands).toEqual([
      { path: MANAGED, layer: "managed", value: "docker *" },
      { path: USER, layer: "user", value: "gh *" },
      { path: PROJECT, layer: "project", value: "terraform *" },
    ]);
  });

  it("feeds WebFetch(domain:...) rules into the domain lists, but not a bare WebFetch", async () => {
    const ctx = await resolve(
      {
        [USER]: {
          sandbox: { network: { allowedDomains: ["github.com"], deniedDomains: ["uploads.github.com"] } },
          permissions: {
            allow: ["WebFetch(domain:*.npmjs.org)", "WebFetch"],
            ask: ["WebFetch(domain:ask.example.com)"],
            deny: ["WebFetch(domain:evil.example.com)"],
          },
        },
      },
      "src/a.ts",
    );
    expect(ctx.sandbox.allowedDomains.map((item) => [item.value, item.fromPermission])).toEqual([
      ["github.com", undefined],
      ["*.npmjs.org", "WebFetch(domain:*.npmjs.org)"],
    ]);
    expect(ctx.sandbox.deniedDomains.map((item) => item.value)).toEqual([
      "uploads.github.com",
      "evil.example.com",
    ]);
  });

  it("honors only managed allowed domains under allowManagedDomainsOnly", async () => {
    const ctx = await resolve(
      {
        [MANAGED]: {
          sandbox: { network: { allowManagedDomainsOnly: true, allowedDomains: ["github.com"] } },
        },
        [PROJECT]: {
          sandbox: { network: { allowedDomains: ["pastebin.com"], deniedDomains: ["x.example.com"] } },
          permissions: { allow: ["WebFetch(domain:gist.github.com)"] },
        },
      },
      "src/a.ts",
    );
    const allowed = Object.fromEntries(
      ctx.sandbox.allowedDomains.map((item) => [item.value, item.ignored]),
    );
    expect(allowed["github.com"]).toBeUndefined();
    expect(allowed["pastebin.com"]).toMatch(/allowManagedDomainsOnly/);
    expect(allowed["gist.github.com"]).toMatch(/allowManagedDomainsOnly/);
    // The deny list always merges.
    expect(ctx.sandbox.deniedDomains[0]?.ignored).toBeUndefined();
  });

  it("ignores a managed-only lock set outside managed settings", async () => {
    const ctx = await resolve(
      {
        [USER]: {
          sandbox: { network: { allowManagedDomainsOnly: true, allowedDomains: ["github.com"] } },
        },
      },
      "src/a.ts",
    );
    expect(ctx.sandbox.allowedDomains[0]?.ignored).toBeUndefined();
  });
});

describe("sandbox path prefixes", () => {
  const paths = [
    "/tmp/build",
    "//opt/cache",
    "~/.kube",
    "~/.aws/",
    "./output",
    "dist/**",
    ".",
    "/**",
  ];

  it("resolves project paths against the project root", async () => {
    const ctx = await resolve(
      { [PROJECT]: { sandbox: { filesystem: { allowWrite: paths } } } },
      "src/a.ts",
    );
    expect(ctx.sandbox.filesystem.map((rule) => rule.resolved)).toEqual([
      "/tmp/build",
      "/opt/cache",
      `${HOME}/.kube`,
      `${HOME}/.aws`,
      `${FOLDER}/output`,
      `${FOLDER}/dist`,
      FOLDER,
      "/",
    ]);
    expect(ctx.sandbox.filesystem.every((rule) => rule.kind === "allowWrite")).toBe(true);
  });

  it("resolves user paths against ~/.claude", async () => {
    const ctx = await resolve(
      { [USER]: { sandbox: { filesystem: { allowRead: ["./output", "."] } } } },
      "src/a.ts",
    );
    expect(ctx.sandbox.filesystem.map((rule) => rule.resolved)).toEqual([
      `${HOME}/.claude/output`,
      `${HOME}/.claude`,
    ]);
  });

  it("anchors local paths at the working directory and managed ones at the managed directory", async () => {
    const ctx = await resolve(
      {
        [LOCAL]: { sandbox: { filesystem: { denyWrite: ["gen"] } } },
        [MANAGED]: { sandbox: { filesystem: { denyWrite: ["policy"] } } },
      },
      "src/a.ts",
    );
    expect(entry(ctx, "gen").resolved).toBe(`${FOLDER}/gen`);
    expect(entry(ctx, "policy").resolved).toBe("/etc/claude-code/policy");
  });

  it("skips wildcard write entries on Linux but not on macOS", async () => {
    const files = {
      [PROJECT]: {
        sandbox: { filesystem: { allowWrite: ["./out/*.log", "./build/**"], denyRead: ["~/**/.env"] } },
      },
    };
    const linux = await resolve(files, "src/a.ts");
    expect(entry(linux, "./out/*.log").ignored).toMatch(/Linux/);
    expect(entry(linux, "./build/**").ignored).toBeUndefined();
    expect(entry(linux, "~/**/.env").ignored).toBeUndefined();

    const mac = await resolve(files, "src/a.ts", { platform: "darwin" });
    expect(entry(mac, "./out/*.log").ignored).toBeUndefined();
  });
});

describe("permission rules feeding the sandbox", () => {
  it("adds Edit allow/deny and Read deny paths, with the rule text", async () => {
    const ctx = await resolve(
      {
        [PROJECT]: {
          permissions: {
            allow: ["Edit(./dist/**)", "Read(./docs/**)", "Edit"],
            ask: ["Edit(./ask/**)"],
            deny: ["Edit(//etc/**)", "Read(./.env)", "Read(!sample.env)"],
          },
        },
      },
      "src/a.ts",
    );
    expect(
      ctx.sandbox.filesystem.map((rule) => [rule.kind, rule.resolved, rule.fromPermission]),
    ).toEqual([
      ["allowWrite", `${FOLDER}/dist`, "Edit(./dist/**)"],
      ["denyWrite", "/etc", "Edit(//etc/**)"],
      ["denyRead", `${FOLDER}/.env`, "Read(./.env)"],
    ]);
  });

  it("keeps the permission syntax: `/path` is settings-relative, bare names any depth", async () => {
    const ctx = await resolve(
      { [USER]: { permissions: { deny: ["Read(/secrets/**)", "Read(.env)"] } } },
      "src/a.ts",
    );
    expect(entry(ctx, "/secrets/**").resolved).toBe(`${HOME}/.claude/secrets`);
    expect(entry(ctx, ".env").resolved).toBe(`${FOLDER}/**/.env`);
  });

  it("skips rules dropped by allowManagedPermissionRulesOnly", async () => {
    const ctx = await resolve(
      {
        [MANAGED]: { allowManagedPermissionRulesOnly: true },
        [PROJECT]: { permissions: { allow: ["Edit(./dist/**)", "WebFetch(domain:x.com)"] } },
      },
      "src/a.ts",
    );
    expect(ctx.sandbox.filesystem).toEqual([]);
    expect(ctx.sandbox.allowedDomains).toEqual([]);
  });
});

describe("credential files", () => {
  const files = {
    [USER]: {
      sandbox: {
        credentials: {
          files: [
            { path: "~/.aws/credentials", mode: "deny" },
            { path: "~/.config/gh/hosts.yml", mode: "mask" },
          ],
        },
      },
    },
    [PROJECT]: {
      sandbox: { credentials: { files: [{ path: "~/.netrc", mode: "mask" }] } },
    },
  };

  it("treats deny entries as read blocks everywhere and mask entries only on macOS", async () => {
    const linux = await resolve(files, "src/a.ts");
    expect(linux.sandbox.filesystem.map((rule) => [rule.pattern, rule.fromCredentials])).toEqual([
      ["~/.aws/credentials", "deny"],
    ]);

    const mac = await resolve(files, "src/a.ts", { platform: "darwin" });
    expect(entry(mac, "~/.config/gh/hosts.yml")).toMatchObject({
      kind: "denyRead",
      fromCredentials: "mask",
    });
    expect(entry(mac, "~/.netrc").ignored).toMatch(/project and local/);
  });

  it("denies a sandboxed read of a denied credential file", async () => {
    const ctx = await resolveContext(HOME, ".aws/credentials", {
      fs: memfs({ [USER]: JSON.stringify(on(files[USER].sandbox)) }),
      homeDir: HOME,
      platform: "linux",
    });
    expect(ctx.sandbox.target).toMatchObject({ read: "denied" });
    expect(ctx.sandbox.target?.reason).toMatch(/credentials\.files "~\/\.aws\/credentials"/);
  });
});

describe("sandbox target verdict", () => {
  it("lets a sandboxed command read and write inside the working directory", async () => {
    const ctx = await resolve({ [PROJECT]: on() }, "src/a.ts");
    expect(ctx.sandbox.target).toMatchObject({ read: "allowed", write: "allowed" });
    expect(ctx.sandbox.target?.reason).toMatch(/by default/);
    expect(ctx.sandbox.target?.reason).toMatch(/working directory/);
  });

  it("refuses writes outside the writable directories until allowWrite opens them", async () => {
    const outside = await resolveContext(FOLDER, "/opt/cache/x", {
      fs: memfs({ [PROJECT]: JSON.stringify(on()) }),
      homeDir: HOME,
      platform: "linux",
    });
    expect(outside.sandbox.target).toMatchObject({ read: "allowed", write: "denied" });

    const opened = await resolveContext(FOLDER, "/opt/cache/x", {
      fs: memfs({ [PROJECT]: JSON.stringify(on({ filesystem: { allowWrite: ["/opt/cache"] } })) }),
      homeDir: HOME,
      platform: "linux",
    });
    expect(opened.sandbox.target).toMatchObject({ write: "allowed" });
    expect(opened.sandbox.target?.reason).toMatch(/allowWrite "\/opt\/cache"/);
    expect(entry(opened, "/opt/cache").matchesTarget).toBe(true);
  });

  it("opens additional directories for writing", async () => {
    const ctx = await resolveContext(FOLDER, `${HOME}/work/docs/a.md`, {
      fs: memfs({
        [PROJECT]: JSON.stringify({ ...on(), permissions: { additionalDirectories: ["../docs/"] } }),
      }),
      homeDir: HOME,
      platform: "linux",
    });
    expect(ctx.sandbox.target).toMatchObject({ write: "allowed" });
    expect(ctx.sandbox.target?.reason).toMatch(/additional directory/);
  });

  it("lets denyWrite beat allowWrite, and an Edit deny count as denyWrite", async () => {
    const ctx = await resolve(
      {
        [PROJECT]: {
          ...on({ filesystem: { allowWrite: ["./gen/deep"] } }),
          permissions: { deny: ["Edit(./gen/**)"] },
        },
      },
      "gen/deep/a.ts",
    );
    expect(ctx.sandbox.target).toMatchObject({ read: "allowed", write: "denied" });
    expect(ctx.sandbox.target?.reason).toMatch(/Edit\(\.\/gen\/\*\*\)/);
  });

  it("keeps protected paths read-only whatever allowWrite says", async () => {
    const files = {
      [PROJECT]: on({ filesystem: { allowWrite: ["./.claude"] } }),
      [USER]: { permissions: { allow: ["Edit(//**)"] } },
    };
    for (const target of [
      ".claude/settings.json",
      ".claude/skills/x/SKILL.md",
      ".mcp.json",
      ".git/hooks/pre-commit",
      ".zshrc",
    ]) {
      const ctx = await resolve(files, target, { platform: "darwin" });
      expect(ctx.sandbox.target?.write, target).toBe("denied");
      expect(ctx.sandbox.target?.reason, target).toMatch(/protected path/);
    }
    // Directories above the working directory protect their settings too.
    const above = await resolveContext(FOLDER, `${HOME}/work/.claude/settings.json`, {
      fs: memfs({ [PROJECT]: JSON.stringify(on({ filesystem: { allowWrite: ["../"] } })) }),
      homeDir: HOME,
      platform: "linux",
    });
    expect(above.sandbox.target?.write).toBe("denied");
    // `~/.claude` is protected.
    const userDir = await resolveContext(FOLDER, `${HOME}/.claude/CLAUDE.md`, {
      fs: memfs({ [PROJECT]: JSON.stringify(on({ filesystem: { allowWrite: ["~/"] } })) }),
      homeDir: HOME,
      platform: "linux",
    });
    expect(userDir.sandbox.target?.write).toBe("denied");
  });

  it("re-opens a narrower allowRead inside a denyRead", async () => {
    const files = {
      [USER]: on({ filesystem: { denyRead: ["~/"], allowRead: ["~/work"] } }),
    };
    const inside = await resolve(files, "src/a.ts");
    expect(inside.sandbox.target).toMatchObject({ read: "allowed" });
    expect(inside.sandbox.target?.reason).toMatch(/re-opened by allowRead "~\/work"/);

    const secret = await resolveContext(FOLDER, `${HOME}/.ssh/id_rsa`, {
      fs: memfs({ [USER]: JSON.stringify(files[USER]) }),
      homeDir: HOME,
      platform: "linux",
    });
    expect(secret.sandbox.target).toMatchObject({ read: "denied" });
    expect(secret.sandbox.target?.reason).toMatch(/denyRead "~\/"/);
  });

  it("keeps a denyRead, exact or wildcard, inside a wider allowRead", async () => {
    const exact = await resolve(
      { [PROJECT]: on({ filesystem: { allowRead: ["~/"], denyRead: ["./.env"] } }) },
      ".env",
    );
    expect(exact.sandbox.target).toMatchObject({ read: "denied" });

    const wildcard = await resolve(
      { [PROJECT]: on({ filesystem: { allowRead: ["~/"], denyRead: ["~/**/.env"] } }) },
      "src/.env",
    );
    expect(wildcard.sandbox.target).toMatchObject({ read: "denied" });
    expect(entry(wildcard, "~/**/.env").matchesTarget).toBe(true);

    // Same depth: the deny holds.
    const tie = await resolve(
      { [PROJECT]: on({ filesystem: { allowRead: ["./src"], denyRead: ["./src"] } }) },
      "src/a.ts",
    );
    expect(tie.sandbox.target).toMatchObject({ read: "denied" });
  });

  it("feeds a Read deny rule into the read verdict", async () => {
    const ctx = await resolve(
      { [PROJECT]: { ...on(), permissions: { deny: ["Read(secrets/**)"] } } },
      "lib/secrets/key.pem",
    );
    expect(ctx.sandbox.target).toMatchObject({ read: "denied", write: "allowed" });
  });

  it("honors only managed allowRead entries under allowManagedReadPathsOnly", async () => {
    const ctx = await resolve(
      {
        [MANAGED]: { sandbox: { filesystem: { denyRead: ["~/"], allowManagedReadPathsOnly: true } } },
        [PROJECT]: on({ filesystem: { allowRead: ["."] } }),
      },
      "src/a.ts",
    );
    expect(entry(ctx, ".").ignored).toMatch(/allowManagedReadPathsOnly/);
    expect(ctx.sandbox.target).toMatchObject({ read: "denied" });
  });

  it("blocks reads outside the working directories under blockReadsOutsideWorkingDirectories", async () => {
    const settings = { ...on(), permissions: { blockReadsOutsideWorkingDirectories: true } };
    const outside = await resolveContext(FOLDER, `${HOME}/notes/a.md`, {
      fs: memfs({ [PROJECT]: JSON.stringify(settings) }),
      homeDir: HOME,
      platform: "linux",
    });
    expect(outside.sandbox.target).toMatchObject({ read: "denied" });
    expect(outside.sandbox.target?.reason).toMatch(/blockReadsOutsideWorkingDirectories/);

    const inside = await resolve({ [PROJECT]: settings }, "src/a.ts");
    expect(inside.sandbox.target).toMatchObject({ read: "allowed" });

    // A `false` elsewhere doesn't lift it; an allowRead re-opens a path.
    const reopened = await resolveContext(FOLDER, `${HOME}/.gitconfig`, {
      fs: memfs({
        [PROJECT]: JSON.stringify(settings),
        [USER]: JSON.stringify({
          permissions: { blockReadsOutsideWorkingDirectories: false },
          sandbox: { filesystem: { allowRead: ["~/.gitconfig"] } },
        }),
      }),
      homeDir: HOME,
      platform: "linux",
    });
    expect(reopened.sandbox.target).toMatchObject({ read: "allowed" });
  });

  it("describes a folder target and what is denied inside it", async () => {
    const ctx = await resolve(
      { [PROJECT]: on({ filesystem: { denyWrite: ["./src/generated"], denyRead: ["./src/secret"] } }) },
      "src",
      { targetKind: "directory" },
    );
    expect(ctx.sandbox.target).toMatchObject({ read: "allowed", write: "allowed" });
    expect(ctx.sandbox.target?.reason).toMatch(/denyWrite "\.\/src\/generated" .*blocks paths inside/);
    expect(ctx.sandbox.target?.reason).toMatch(/denyRead "\.\/src\/secret" .*blocks paths inside/);
    expect(entry(ctx, "./src/generated").matchesTarget).toBe(true);

    const root = await resolve({ [PROJECT]: on() }, ".", { targetKind: "directory" });
    expect(root.sandbox.target?.reason).toMatch(/protected paths inside/);
  });
});

describe("sandbox.filesystem.disabled", () => {
  it("opens the filesystem when user settings set it", async () => {
    const ctx = await resolve(
      {
        [USER]: on({ filesystem: { disabled: true } }),
        [PROJECT]: { sandbox: { filesystem: { denyRead: ["./src"] } } },
      },
      "src/a.ts",
    );
    expect(ctx.sandbox.filesystemDisabled).toMatchObject({ value: true, source: { layer: "user" } });
    expect(ctx.sandbox.target).toMatchObject({ read: "allowed", write: "allowed" });
    expect(ctx.sandbox.target?.reason).toMatch(/filesystem isolation is off/i);
  });

  it("ignores it in project and local settings", async () => {
    const ctx = await resolve(
      { [PROJECT]: on({ filesystem: { disabled: true } }), [LOCAL]: on({ filesystem: { disabled: true } }) },
      "src/a.ts",
    );
    expect(ctx.sandbox.filesystemDisabled.value).toBe(false);
    expect(ctx.sandbox.filesystemDisabled.note).toMatch(/project settings can't set it/);
    expect(ctx.sandbox.filesystemDisabled.note).toMatch(/local settings can't set it/);
  });

  it("locks it to managed settings once they configure the filesystem", async () => {
    const ctx = await resolve(
      {
        [MANAGED]: { sandbox: { filesystem: { denyRead: ["~/.ssh"] } } },
        [USER]: on({ filesystem: { disabled: true } }),
      },
      "src/a.ts",
    );
    expect(ctx.sandbox.filesystemDisabled.value).toBe(false);
    expect(ctx.sandbox.filesystemDisabled.note).toMatch(/only they can set it/);

    const byCredentials = await resolve(
      {
        [MANAGED]: { sandbox: { credentials: { files: [{ path: "~/.aws", mode: "deny" }] } } },
        [USER]: on({ filesystem: { disabled: true } }),
      },
      "src/a.ts",
    );
    expect(byCredentials.sandbox.filesystemDisabled.value).toBe(false);
  });

  it("keeps a macOS mask credential blocking reads with isolation off", async () => {
    const ctx = await resolveContext(HOME, ".config/gh/hosts.yml", {
      fs: memfs({
        [USER]: JSON.stringify(
          on({
            filesystem: { disabled: true },
            credentials: { files: [{ path: "~/.config/gh/hosts.yml", mode: "mask" }] },
          }),
        ),
      }),
      homeDir: HOME,
      platform: "darwin",
    });
    expect(ctx.sandbox.target).toMatchObject({ read: "denied", write: "allowed" });
  });
});
