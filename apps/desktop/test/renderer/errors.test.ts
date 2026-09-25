import { describe, expect, it } from "vitest";

import { errorMessage } from "../../src/renderer/src/lib/errors";

describe("errorMessage", () => {
  it("strips Electron's IPC wrapper, with or without the inner Error: prefix", () => {
    expect(
      errorMessage(new Error("Error invoking remote method 'ssh:connect': Error: Permission denied (publickey).")),
    ).toBe("Permission denied (publickey).");
    expect(errorMessage(new Error("Error invoking remote method 'fs:listTree': No folder at /x"))).toBe(
      "No folder at /x",
    );
  });

  it("keeps other messages and stringifies non-errors", () => {
    expect(errorMessage(new Error("plain"))).toBe("plain");
    expect(errorMessage("text")).toBe("text");
    expect(errorMessage(42)).toBe("42");
  });

  it("keeps multi-line ssh output after the prefix", () => {
    expect(
      errorMessage(new Error("Error invoking remote method 'ssh:connect': Error: line one\nline two")),
    ).toBe("line one\nline two");
  });
});
