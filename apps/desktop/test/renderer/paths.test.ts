import { describe, expect, it } from "vitest";

import type { FileNode } from "../../src/shared/ipc";
import {
  ancestorDirs,
  basename,
  compactPath,
  countNodes,
  dirname,
  displayPath,
  formatBytes,
  languageOf,
  projectPath,
  rowPath,
  relativeTo,
} from "../../src/renderer/src/lib/paths";

const HOME = "/Users/me";
const FOLDER = "/Users/me/projects/app";

describe("basename and dirname", () => {
  it("split on the last slash", () => {
    expect(basename("/a/b/c.md")).toBe("c.md");
    expect(dirname("/a/b/c.md")).toBe("/a/b");
    expect(dirname("/c.md")).toBe("/");
    expect(dirname("c.md")).toBe("/");
  });
});

describe("relativeTo", () => {
  it("is empty for the folder itself and null outside it", () => {
    expect(relativeTo(FOLDER, FOLDER)).toBe("");
    expect(relativeTo(`${FOLDER}/src/a.ts`, FOLDER)).toBe("src/a.ts");
    expect(relativeTo("/elsewhere/a.ts", FOLDER)).toBeNull();
  });

  it("does not treat a sibling with the same prefix as inside", () => {
    expect(relativeTo(`${FOLDER}-old/a.ts`, FOLDER)).toBeNull();
  });
});

describe("displayPath", () => {
  it("shows paths inside the folder relative to it", () => {
    expect(displayPath(`${FOLDER}/src/a.ts`, FOLDER, HOME)).toBe("src/a.ts");
    expect(displayPath(FOLDER, FOLDER, HOME)).toBe("app");
  });

  it("shows other paths under home with ~", () => {
    expect(displayPath(`${HOME}/.claude/CLAUDE.md`, FOLDER, HOME)).toBe("~/.claude/CLAUDE.md");
    expect(displayPath(HOME, null, HOME)).toBe("~");
    expect(displayPath(`${HOME}er/x`, null, HOME)).toBe(`${HOME}er/x`);
  });

  it("leaves everything else absolute, including when home is unknown", () => {
    expect(displayPath("/etc/claude/settings.json", FOLDER, HOME)).toBe("/etc/claude/settings.json");
    expect(displayPath(`${HOME}/x`, null, "")).toBe(`${HOME}/x`);
  });

  it("uses the remote home for remote folders", () => {
    expect(displayPath("/home/deploy/app", null, "/home/deploy")).toBe("~/app");
  });
});

describe("projectPath", () => {
  it("prefixes paths inside the folder with the folder name", () => {
    expect(projectPath(`${FOLDER}/src/a.ts`, FOLDER, HOME)).toBe("app/src/a.ts");
    expect(projectPath(FOLDER, FOLDER, HOME)).toBe("app");
    expect(projectPath(`${HOME}/x`, FOLDER, HOME)).toBe("~/x");
  });
});

describe("ancestorDirs", () => {
  it("lists the folders from the root down to the target's parent", () => {
    expect(ancestorDirs(`${FOLDER}/a/b/c.ts`, FOLDER)).toEqual([FOLDER, `${FOLDER}/a`, `${FOLDER}/a/b`]);
    expect(ancestorDirs(`${FOLDER}/c.ts`, FOLDER)).toEqual([FOLDER]);
    expect(ancestorDirs("/elsewhere/c.ts", FOLDER)).toEqual([FOLDER]);
  });
});

describe("languageOf", () => {
  it("maps extensions, special names and unknowns", () => {
    expect(languageOf("index.tsx")).toBe("TypeScript");
    expect(languageOf("CLAUDE.md")).toBe("Markdown");
    expect(languageOf("settings.JSON")).toBe("JSON");
    expect(languageOf("Dockerfile")).toBe("Docker");
    expect(languageOf(".env.local")).toBe("Dotenv");
    expect(languageOf("Makefile")).toBe("Text");
    expect(languageOf(".gitignore")).toBe("Text");
    expect(languageOf("schema.proto")).toBe("PROTO");
  });
});

describe("formatBytes", () => {
  it("shows small sizes in bytes and the rest in KB", () => {
    expect(formatBytes(undefined)).toBeNull();
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(99)).toBe("99 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});

describe("countNodes", () => {
  it("counts the root and every descendant", () => {
    const tree: FileNode = {
      name: "p",
      path: "/p",
      kind: "dir",
      marks: [],
      children: [
        { name: "a", path: "/p/a", kind: "dir", marks: [], children: [{ name: "x", path: "/p/a/x", kind: "file", marks: [] }] },
        { name: "b", path: "/p/b", kind: "file", marks: [] },
      ],
    };

    expect(countNodes(tree)).toBe(4);
  });
});

describe("compactPath", () => {
  it("keeps short paths whole", () => {
    expect(compactPath("/Users/me/code/app", "/Users/me")).toBe("~/code/app");
    expect(compactPath("/srv/app", "/Users/me")).toBe("/srv/app");
  });

  it("folds everything but the last two segments", () => {
    expect(compactPath("/private/tmp/a/b/vfx/kitchen-sink", "/Users/me")).toBe("/…/vfx/kitchen-sink");
    expect(compactPath("/Users/me/projects/cesar/agentview/app", "/Users/me")).toBe("~/…/agentview/app");
  });
});

describe("rowPath", () => {
  it("folds long absolute paths outside the project and home", () => {
    expect(rowPath("/private/tmp/x/y/config/CLAUDE.md", FOLDER, HOME)).toBe("/…/y/config/CLAUDE.md");
    expect(rowPath("/etc/claude/settings.json", FOLDER, HOME)).toBe("/etc/claude/settings.json");
  });

  it("leaves project and home paths alone", () => {
    expect(rowPath(`${FOLDER}/src/a.ts`, FOLDER, HOME)).toBe("app/src/a.ts");
    expect(rowPath(`${HOME}/.claude/a/b/c/CLAUDE.md`, FOLDER, HOME)).toBe("~/.claude/a/b/c/CLAUDE.md");
  });
});
