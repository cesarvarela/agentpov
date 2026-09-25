import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import type { SshPrompt } from "../../src/shared/ipc";
import { askpassEnv, startAskpass, stopAskpass, type PromptHandler } from "../../src/main/ssh/askpass";

/**
 * The askpass bridge end to end: ssh would run SSH_ASKPASS with the prompt as
 * its argument; here the test runs it directly, with Node standing in for the
 * app binary (askpassEnv points AGENTPOV_ASKPASS_NODE at process.execPath).
 */

let handler: PromptHandler = async () => null;

function runAskpass(prompt: string, env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn(env["SSH_ASKPASS"]!, [prompt], { env: { ...process.env, ...env } });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

afterAll(() => stopAskpass());

describe("askpass bridge", () => {
  it("tells ssh never to prompt before the bridge is running", () => {
    expect(askpassEnv("host", 1)).toEqual({ SSH_ASKPASS_REQUIRE: "never" });
  });

  describe("running", () => {
    it("routes ssh through the helper with the host and window", () => {
      startAskpass((prompt, windowId) => handler(prompt, windowId));
      const env = askpassEnv("db.example", 7);

      expect(env).toMatchObject({
        SSH_ASKPASS_REQUIRE: "force",
        AGENTPOV_ASKPASS_HOST: "db.example",
        AGENTPOV_ASKPASS_WINDOW: "7",
        AGENTPOV_ASKPASS_NODE: process.execPath,
      });
      expect(env["DISPLAY"]).toBeTruthy();
      expect(existsSync(env["SSH_ASKPASS"]!)).toBe(true);
    });

    it("hands the prompt to the handler and prints the answer for ssh", async () => {
      const seen: { prompt: SshPrompt; windowId: number | null }[] = [];
      handler = async (prompt, windowId) => {
        seen.push({ prompt, windowId });
        return "hunter2";
      };

      const result = await runAskpass("Enter passphrase for key '/k':", askpassEnv("db.example", 7));

      expect(result).toEqual({ code: 0, stdout: "hunter2\n" });
      expect(seen).toEqual([
        {
          prompt: { id: expect.any(Number), host: "db.example", message: "Enter passphrase for key '/k':" },
          windowId: 7,
        },
      ]);
    });

    it("passes an empty answer through, which ssh treats as a real reply", async () => {
      handler = async () => "";

      expect(await runAskpass("Password:", askpassEnv("h", 1))).toEqual({ code: 0, stdout: "\n" });
    });

    it("exits non-zero when the prompt is cancelled, so ssh gives up", async () => {
      handler = async () => null;

      expect(await runAskpass("Password:", askpassEnv("h", 1))).toEqual({ code: 1, stdout: "" });
    });

    it("exits non-zero when the handler throws", async () => {
      handler = async () => {
        throw new Error("window gone");
      };

      expect(await runAskpass("Password:", askpassEnv("h", 1))).toEqual({ code: 1, stdout: "" });
    });

    it("reports no window when the connection had none", async () => {
      let windowId: number | null | undefined;
      handler = async (_prompt, id) => {
        windowId = id;
        return "x";
      };

      await runAskpass("Password:", askpassEnv("h", null));

      expect(windowId).toBeNull();
    });

    it("numbers prompts so answers can't cross", async () => {
      const ids: number[] = [];
      handler = async (prompt) => {
        ids.push(prompt.id);
        return String(prompt.id);
      };

      const [a, b] = await Promise.all([
        runAskpass("first", askpassEnv("h", 1)),
        runAskpass("second", askpassEnv("h", 1)),
      ]);

      expect(new Set(ids).size).toBe(2);
      expect([a.stdout, b.stdout].sort()).toEqual(ids.map((id) => `${id}\n`).sort());
    });

    it("removes its files on stop and goes back to never prompting", () => {
      const script = askpassEnv("h", 1)["SSH_ASKPASS"]!;

      stopAskpass();

      expect(existsSync(dirname(script))).toBe(false);
      expect(askpassEnv("h", 1)).toEqual({ SSH_ASKPASS_REQUIRE: "never" });
    });
  });
});
