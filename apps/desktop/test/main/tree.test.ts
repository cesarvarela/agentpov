import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FileNode } from "../../src/shared/ipc";
import { buildTree, listTree, marksForName, MAX_DEPTH } from "../../src/main/tree";

function names(node: FileNode | undefined): string[] {
  return (node?.children ?? []).map((child) => child.name);
}

function child(node: FileNode | undefined, name: string): FileNode | undefined {
  return node?.children?.find((c) => c.name === name);
}

const file = (path: string) => ({ path, isDirectory: false });
const dir = (path: string) => ({ path, isDirectory: true });

describe("marksForName", () => {
  it("marks instruction files, settings and .claude folders", () => {
    expect(marksForName("CLAUDE.md", "file")).toEqual(["instructions"]);
    expect(marksForName("CLAUDE.local.md", "file")).toEqual(["instructions"]);
    expect(marksForName("settings.local.json", "file")).toEqual(["instructions"]);
    expect(marksForName(".claude", "dir")).toEqual(["instructions"]);
    expect(marksForName(".mcp.json", "file")).toEqual(["mcp"]);
  });

  it("leaves other names unmarked", () => {
    expect(marksForName("README.md", "file")).toEqual([]);
    expect(marksForName("settings", "dir")).toEqual([]);
    expect(marksForName("CLAUDE.md", "dir")).toEqual([]);
  });
});

describe("buildTree", () => {
  it("nests entries under their parents whatever order find returns them in", () => {
    const tree = buildTree("/p", [
      file("/p/src/main/index.ts"),
      dir("/p/src/main"),
      file("/p/README.md"),
      dir("/p/src"),
    ], MAX_DEPTH);

    expect(tree).toMatchObject({ name: "p", path: "/p", kind: "dir" });
    expect(names(tree)).toEqual(["src", "README.md"]);
    expect(names(child(child(tree, "src"), "main"))).toEqual(["index.ts"]);
    expect(child(child(child(tree, "src"), "main"), "index.ts")?.path).toBe("/p/src/main/index.ts");
  });

  it("sorts folders first, then names with numbers in numeric order", () => {
    const tree = buildTree("/p", [
      file("/p/b10.md"),
      file("/p/b2.md"),
      dir("/p/zeta"),
      file("/p/a.md"),
      dir("/p/alpha"),
    ], MAX_DEPTH);

    expect(names(tree)).toEqual(["alpha", "zeta", "a.md", "b2.md", "b10.md"]);
  });

  it("gives every folder a children array and every file none", () => {
    const tree = buildTree("/p", [dir("/p/empty"), file("/p/x.ts")], MAX_DEPTH);

    expect(child(tree, "empty")?.children).toEqual([]);
    expect(child(tree, "x.ts")?.children).toBeUndefined();
  });

  it("marks nodes by name", () => {
    const tree = buildTree("/p", [
      dir("/p/.claude"),
      file("/p/.claude/settings.json"),
      file("/p/CLAUDE.md"),
    ], MAX_DEPTH);

    expect(child(tree, ".claude")?.marks).toEqual(["instructions"]);
    expect(child(child(tree, ".claude"), "settings.json")?.marks).toEqual(["instructions"]);
    expect(child(tree, "CLAUDE.md")?.marks).toEqual(["instructions"]);
  });

  it("keeps folders at the depth cap but drops what is below them", () => {
    const tree = buildTree("/p", [
      dir("/p/a"),
      dir("/p/a/b"),
      file("/p/a/b/deep.md"),
      file("/p/a/shallow.md"),
    ], 2);

    const b = child(child(tree, "a"), "b");
    expect(names(child(tree, "a"))).toEqual(["b", "shallow.md"]);
    expect(b?.children).toEqual([]);
  });

  it("ignores entries outside the folder, including sibling prefixes", () => {
    const tree = buildTree("/p", [
      file("/p/in.md"),
      file("/other/out.md"),
      file("/p2/sibling.md"),
      file("/p"),
    ], MAX_DEPTH);

    expect(names(tree)).toEqual(["in.md"]);
  });

  it("skips entries whose parent folder was never listed", () => {
    const tree = buildTree("/p", [file("/p/missing/orphan.md"), file("/p/ok.md")], MAX_DEPTH);

    expect(names(tree)).toEqual(["ok.md"]);
  });

  it("handles the filesystem root", () => {
    const tree = buildTree("/", [dir("/etc"), file("/etc/hosts"), file("/x")], MAX_DEPTH);

    expect(tree.name).toBe("/");
    expect(names(tree)).toEqual(["etc", "x"]);
    expect(names(child(tree, "etc"))).toEqual(["hosts"]);
  });

  it("keeps names with spaces and tabs intact", () => {
    const tree = buildTree("/p", [file("/p/a b\tc.md")], MAX_DEPTH);

    expect(names(tree)).toEqual(["a b\tc.md"]);
  });
});

describe("listTree", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "agentpov-tree-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("walks the folder, skipping noise directories", async () => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "index.ts"), "");
    await writeFile(join(root, "CLAUDE.md"), "");
    for (const skipped of ["node_modules", ".git", "dist"]) {
      await mkdir(join(root, skipped));
      await writeFile(join(root, skipped, "x"), "");
    }

    const tree = await listTree(root);

    expect(tree.path).toBe(root);
    expect(names(tree)).toEqual(["src", "CLAUDE.md"]);
    expect(names(child(tree, "src"))).toEqual(["index.ts"]);
    expect(child(tree, "CLAUDE.md")?.marks).toEqual(["instructions"]);
  });

  it("leaves out symlinks", async () => {
    await writeFile(join(root, "real.md"), "");
    await symlink(join(root, "real.md"), join(root, "link.md"));

    expect(names(await listTree(root))).toEqual(["real.md"]);
  });

  it("stops at MAX_DEPTH, like the remote walk", async () => {
    let path = root;
    for (let depth = 1; depth <= MAX_DEPTH + 1; depth++) {
      path = join(path, `d${depth}`);
      await mkdir(path);
    }

    let node: FileNode | undefined = await listTree(root);
    for (let depth = 1; depth <= MAX_DEPTH; depth++) node = child(node, `d${depth}`);

    expect(node?.name).toBe(`d${MAX_DEPTH}`);
    expect(node?.children).toEqual([]);
  });

  it("returns an empty tree for a folder it cannot read", async () => {
    const tree = await listTree(join(root, "missing"));

    expect(tree.children).toEqual([]);
  });
});
