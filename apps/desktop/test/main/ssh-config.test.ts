import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listSshHosts } from "../../src/main/ssh/config";

describe("listSshHosts", () => {
  let home: string;
  let sshDir: string;
  const originalHome = process.env["HOME"];

  beforeEach(async () => {
    // os.homedir() reads HOME, so this points ~/.ssh at a scratch folder.
    home = await mkdtemp(join(tmpdir(), "agentpov-home-"));
    sshDir = join(home, ".ssh");
    await mkdir(sshDir);
    process.env["HOME"] = home;
  });

  afterEach(async () => {
    process.env["HOME"] = originalHome;
    await rm(home, { recursive: true, force: true });
  });

  const config = (text: string, name = "config") => writeFile(join(sshDir, name), text);

  it("lists each concrete Host alias once, in file order", async () => {
    await config(
      [
        "Host web",
        "  HostName 10.0.0.1",
        "Host db db-replica",
        "  User admin",
        "Host web",
      ].join("\n"),
    );

    expect(await listSshHosts()).toEqual(["web", "db", "db-replica"]);
  });

  it("skips wildcard and negated patterns", async () => {
    await config("Host *\nHost *.internal dev? !prod staging\n");

    expect(await listSshHosts()).toEqual(["staging"]);
  });

  it("accepts any keyword case, '=' separators, indentation and comments", async () => {
    await config(
      [
        "# Host commented",
        "  HOST upper",
        "host=equals",
        "Host = spaced",
        "\tHost\ttabbed",
        "",
      ].join("\n"),
    );

    expect(await listSshHosts()).toEqual(["upper", "equals", "spaced", "tabbed"]);
  });

  it("follows Include lines relative to ~/.ssh, under ~/ and absolute", async () => {
    await mkdir(join(sshDir, "conf.d"));
    await config("Host main\nInclude conf.d/work ~/.ssh/personal\nInclude " + join(home, "abs") + "\n");
    await config("Host work\n", "conf.d/work");
    await config("Host personal\n", "personal");
    await writeFile(join(home, "abs"), "Host absolute\n");

    expect(await listSshHosts()).toEqual(["main", "work", "personal", "absolute"]);
  });

  it("skips globbed and missing includes and survives include cycles", async () => {
    await config("Host a\nInclude conf.d/* missing loop\n");
    await config("Host b\nInclude config\n", "loop");

    expect(await listSshHosts()).toEqual(["a", "b"]);
  });

  it("returns nothing when there is no config", async () => {
    expect(await listSshHosts()).toEqual([]);
  });
});
