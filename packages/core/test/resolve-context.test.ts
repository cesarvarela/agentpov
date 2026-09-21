import { describe, expect, it } from "vitest";

import { CONFIG_LAYER_PRECEDENCE, resolveContext } from "../src/index.js";

describe("resolveContext", () => {
  it("echoes its inputs and returns an empty result", () => {
    const result = resolveContext("/projects/acme/shop-api", "src/api/payments.ts");

    expect(result.folder).toBe("/projects/acme/shop-api");
    expect(result.file).toBe("src/api/payments.ts");
    expect(result.memory).toEqual([]);
    expect(result.permissions).toEqual([]);
    expect(result.hooks).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("orders config layers lowest to highest precedence", () => {
    expect(CONFIG_LAYER_PRECEDENCE).toEqual([
      "managed",
      "user",
      "project",
      "local",
      "directory",
    ]);
  });
});
