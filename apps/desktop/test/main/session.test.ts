import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { READ_FILE_MAX_BYTES } from "../../src/shared/ipc";
import { decode, parseEntries, RemoteHost } from "../../src/main/ssh/session";

/**
 * RemoteHost against test/fixtures/bin/ssh, which runs the remote read loop
 * with the local /bin/sh: the real protocol, minus the network.
 */

const STUB_BIN = join(__dirname, "../fixtures/bin");
const originalPath = process.env["PATH"];

beforeAll(() => {
  process.env["PATH"] = `${STUB_BIN}${delimiter}${originalPath}`;
});

afterAll(() => {
  process.env["PATH"] = originalPath;
});

afterEach(() => {
  delete process.env["STUB_BANNER"];
  delete process.env["STUB_FAIL"];
});

describe("decode and parseEntries", () => {
  it("decodes base64 fields, treating a missing field as empty", () => {
    expect(decode(Buffer.from("héllo\n", "utf8").toString("base64"))).toBe("héllo\n");
    expect(decode(undefined)).toBe("");
  });

  it("parses d/f listing lines", () => {
    const listing = Buffer.from("d\t/p/src\nf\t/p/a b.md\n\n", "utf8").toString("base64");

    expect(parseEntries(listing)).toEqual([
      { path: "/p/src", isDirectory: true },
      { path: "/p/a b.md", isDirectory: false },
    ]);
    expect(parseEntries(undefined)).toEqual([]);
  });
});

describe("RemoteHost", () => {
  it("refuses host names ssh would read as options", () => {
    expect(() => new RemoteHost("-oProxyCommand=touch /tmp/pwned")).toThrow(/Not an SSH host/);
    expect(() => new RemoteHost("")).toThrow(/Not an SSH host/);
    expect(() => new RemoteHost("host with spaces")).toThrow(/Not an SSH host/);
    expect(() => new RemoteHost("user@example.com")).not.toThrow();
  });

  describe("connected", () => {
    let root: string;
    let remote: RemoteHost;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "agentpov-remote-"));
      remote = new RemoteHost("stub");
    });

    afterEach(async () => {
      remote.close();
      await rm(root, { recursive: true, force: true });
    });

    it("reports the remote home and OS", async () => {
      const info = await remote.connect();

      expect(info.host).toBe("stub");
      expect(info.homeDir).toBe(homedir());
      expect(info.platform).toBe(process.platform === "darwin" ? "darwin" : "linux");
    });

    it("skips login banners before the handshake", async () => {
      process.env["STUB_BANNER"] = "Welcome to stub!\nLast login: yesterday";

      await expect(remote.connect()).resolves.toMatchObject({ host: "stub" });
    });

    it("rejects with ssh's own error when it cannot connect", async () => {
      process.env["STUB_FAIL"] = "stub@example: Permission denied (publickey).";

      await expect(remote.connect()).rejects.toThrow("Permission denied (publickey).");
    });

    it("reads files, and returns null for missing ones and folders", async () => {
      await writeFile(join(root, "CLAUDE.md"), "# Rules\nBe nice ✨\n");

      const fields = await remote.request("read", join(root, "CLAUDE.md"));

      expect(decode(fields?.[0])).toBe("# Rules\nBe nice ✨\n");
      expect(await remote.request("read", join(root, "missing.md"))).toBeNull();
      expect(await remote.request("read", root)).toBeNull();
    });

    it.skipIf(process.getuid?.() === 0)("returns null for unreadable files", async () => {
      const secret = join(root, "secret.md");
      await writeFile(secret, "no");
      await chmod(secret, 0o000);

      expect(await remote.request("read", secret)).toBeNull();
    });

    it("reads an empty file as an empty string", async () => {
      await writeFile(join(root, "empty.md"), "");

      const fields = await remote.request("read", join(root, "empty.md"));

      expect(fields).not.toBeNull();
      expect(decode(fields?.[0])).toBe("");
    });

    it("handles paths with spaces, tabs and quotes", async () => {
      const path = join(root, "a b\t'c\".md");
      await writeFile(path, "odd");

      expect(decode((await remote.request("read", path))?.[0])).toBe("odd");
    });

    it("refuses paths with newlines without desyncing the loop", async () => {
      await writeFile(join(root, "ok.md"), "ok");

      expect(await remote.request("read", `${root}/x\nread\t/etc/hosts`)).toBeNull();
      expect(decode((await remote.request("read", join(root, "ok.md")))?.[0])).toBe("ok");
    });

    it("sizes files", async () => {
      await writeFile(join(root, "f.txt"), "12345");

      expect(await remote.request("size", join(root, "f.txt"))).toEqual(["5"]);
      expect(await remote.request("size", join(root, "nope"))).toBeNull();
    });

    it("head returns the full size and at most READ_FILE_MAX_BYTES of content", async () => {
      const size = READ_FILE_MAX_BYTES + 1000;
      await writeFile(join(root, "big.txt"), "x".repeat(size));

      const fields = await remote.request("head", join(root, "big.txt"));

      expect(Number(fields?.[0])).toBe(size);
      expect(decode(fields?.[1])).toHaveLength(READ_FILE_MAX_BYTES);
    });

    it("tells folders from files", async () => {
      await writeFile(join(root, "f.txt"), "");

      expect(await remote.request("isdir", root)).toEqual([""]);
      expect(await remote.request("isdir", join(root, "f.txt"))).toBeNull();
    });

    it("lists a folder's direct children", async () => {
      await mkdir(join(root, "sub"));
      await writeFile(join(root, "sub", "deep.md"), "");
      await writeFile(join(root, "top.md"), "");

      const entries = parseEntries((await remote.request("list", root))?.[0]);

      expect(entries.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
        { path: join(root, "sub"), isDirectory: true },
        { path: join(root, "top.md"), isDirectory: false },
      ]);
      expect(await remote.request("list", join(root, "top.md"))).toBeNull();
    });

    it("walks the tree, pruning noise folders", async () => {
      await mkdir(join(root, "src", "lib"), { recursive: true });
      await writeFile(join(root, "src", "lib", "a.ts"), "");
      await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
      await writeFile(join(root, "node_modules", "pkg", "index.js"), "");
      await mkdir(join(root, ".git"));

      const paths = parseEntries((await remote.request("tree", root, { cached: false }))?.[0])
        .map((entry) => entry.path.slice(root.length + 1))
        .sort();

      expect(paths).toEqual(["src", "src/lib", "src/lib/a.ts"]);
    });

    it("reassembles responses that arrive in many chunks", async () => {
      // ~3 MB of base64 in one response line, far past a pipe's chunk size.
      const content = Array.from({ length: 40_000 }, (_, i) => `line ${i} ${"·".repeat(20)}`).join("\n");
      await writeFile(join(root, "large.md"), content);
      for (let i = 0; i < 2_000; i++) await writeFile(join(root, `file-${i}-${"n".repeat(60)}.md`), "");

      const [read, tree] = await Promise.all([
        remote.request("read", join(root, "large.md")),
        remote.request("tree", root, { cached: false }),
      ]);

      expect(decode(read?.[0])).toBe(content);
      expect(parseEntries(tree?.[0])).toHaveLength(2_001);
    });

    it("answers concurrent requests in order", async () => {
      await Promise.all(
        Array.from({ length: 20 }, (_, i) => writeFile(join(root, `${i}.txt`), `content ${i}`)),
      );

      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => remote.request("read", join(root, `${i}.txt`))),
      );

      expect(results.map((fields) => decode(fields?.[0]))).toEqual(
        Array.from({ length: 20 }, (_, i) => `content ${i}`),
      );
    });

    describe("cache", () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it("reuses a recent read and shares in-flight requests", async () => {
        const path = join(root, "c.md");
        await writeFile(path, "v1");

        const [first, second] = await Promise.all([remote.request("read", path), remote.request("read", path)]);
        await writeFile(path, "v2");
        const third = await remote.request("read", path);

        expect(second).toBe(first);
        expect(decode(third?.[0])).toBe("v1");
      });

      it("expires entries after the TTL instead of keeping them forever", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout"] });
        const path = join(root, "c.md");
        await writeFile(path, "v1");
        await remote.request("read", path);
        await writeFile(path, "v2");

        vi.advanceTimersByTime(5_000);

        expect(decode((await remote.request("read", path))?.[0])).toBe("v2");
        expect((remote as unknown as { cache: Map<string, unknown> }).cache.size).toBe(1);
      });

      it("skips the cache when asked", async () => {
        const path = join(root, "c.md");
        await writeFile(path, "v1");
        await remote.request("read", path);
        await writeFile(path, "v2");

        expect(decode((await remote.request("read", path, { cached: false }))?.[0])).toBe("v2");
      });
    });

    it("fails pending requests when the connection drops, then reconnects", async () => {
      await remote.connect();
      const child = (remote as unknown as { child: { kill(signal: NodeJS.Signals): void } }).child;
      await writeFile(join(root, "after.md"), "back");

      // Paused, the loop can't answer; the request is queued when it dies.
      child.kill("SIGSTOP");
      const stuck = remote.request("read", join(root, "after.md"), { cached: false });
      child.kill("SIGKILL");

      await expect(stuck).rejects.toThrow();
      expect(decode((await remote.request("read", join(root, "after.md")))?.[0])).toBe("back");
    });
  });
});
