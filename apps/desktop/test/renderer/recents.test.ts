import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadRecents, rememberRecent } from "../../src/renderer/src/lib/recents";

const KEY = "agentpov.recent";

/** In-memory localStorage; `failing` makes every call throw, like a blocked store. */
function memoryStorage(failing = false) {
  const data = new Map<string, string>();
  const guard = () => {
    if (failing) throw new Error("storage disabled");
  };
  return {
    data,
    getItem: (key: string) => (guard(), data.get(key) ?? null),
    setItem: (key: string, value: string) => (guard(), void data.set(key, value)),
  };
}

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadRecents", () => {
  it("is empty when nothing was saved", () => {
    expect(loadRecents()).toEqual([]);
  });

  it("returns saved local and remote entries", () => {
    const saved = [
      { host: "db", path: "/srv/app", homeDir: "/home/me" },
      { host: null, path: "/Users/me/app" },
    ];
    storage.data.set(KEY, JSON.stringify(saved));

    expect(loadRecents()).toEqual(saved);
  });

  it("drops malformed entries instead of failing", () => {
    storage.data.set(
      KEY,
      JSON.stringify([
        { host: null, path: "/ok" },
        { host: null },
        { host: 3, path: "/bad-host" },
        { path: "/no-host" },
        null,
        "string",
      ]),
    );

    expect(loadRecents()).toEqual([{ host: null, path: "/ok" }]);
  });

  it.each([["not json {"], ['{"host":null}'], ["null"]])("treats %s as no recents", (raw) => {
    storage.data.set(KEY, raw);

    expect(loadRecents()).toEqual([]);
  });

  it("returns nothing when storage throws", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage(true) });

    expect(loadRecents()).toEqual([]);
  });
});

describe("rememberRecent", () => {
  it("puts the entry first and saves the list", () => {
    rememberRecent({ host: null, path: "/a" });
    const list = rememberRecent({ host: null, path: "/b" });

    expect(list.map((r) => r.path)).toEqual(["/b", "/a"]);
    expect(JSON.parse(storage.data.get(KEY)!)).toEqual(list);
  });

  it("moves a reopened folder to the front instead of duplicating it", () => {
    rememberRecent({ host: null, path: "/a" });
    rememberRecent({ host: null, path: "/b" });
    const list = rememberRecent({ host: null, path: "/a" });

    expect(list.map((r) => r.path)).toEqual(["/a", "/b"]);
  });

  it("keeps the same path on different machines apart", () => {
    rememberRecent({ host: null, path: "/app" });
    rememberRecent({ host: "db", path: "/app", homeDir: "/home/me" });
    const list = rememberRecent({ host: "web", path: "/app", homeDir: "/home/me" });

    expect(list.map((r) => r.host)).toEqual(["web", "db", null]);
  });

  it("keeps the ten most recent", () => {
    for (let i = 0; i < 12; i++) rememberRecent({ host: null, path: `/p${i}` });

    const list = loadRecents();

    expect(list).toHaveLength(10);
    expect(list[0]?.path).toBe("/p11");
    expect(list.at(-1)?.path).toBe("/p2");
  });

  it("still returns the new list when saving fails", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage(true) });

    expect(rememberRecent({ host: null, path: "/a" })).toEqual([{ host: null, path: "/a" }]);
  });
});
