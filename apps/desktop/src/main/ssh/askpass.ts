import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

import type { SshPrompt } from "../../shared/ipc";

/**
 * SSH_ASKPASS bridge: ssh runs a tiny helper for every passphrase, password,
 * 2FA code or host-key question; the helper forwards the prompt over a local
 * socket to the main process, which asks the renderer and sends the answer
 * back. The helper is a Node script run by this app's own binary.
 */

/** `windowId` is the webContents that started the connection, when known. */
export type PromptHandler = (
  prompt: SshPrompt,
  windowId: number | null,
) => Promise<string | null>;

const HELPER_JS = `
const net = require("node:net");
const socket = net.connect(process.env.AGENTPOV_ASKPASS_SOCK);
let reply = "";
socket.on("connect", () => {
  socket.write(JSON.stringify({ host: process.env.AGENTPOV_ASKPASS_HOST || "", window: process.env.AGENTPOV_ASKPASS_WINDOW || "", prompt: process.argv[2] || "" }) + "\\n");
});
socket.setEncoding("utf8");
socket.on("data", (chunk) => { reply += chunk; });
socket.on("end", () => {
  try {
    const { value } = JSON.parse(reply);
    if (typeof value !== "string") process.exit(1);
    process.stdout.write(value + "\\n");
    process.exit(0);
  } catch {
    process.exit(1);
  }
});
socket.on("error", () => process.exit(1));
`;

let server: Server | null = null;
let paths: { dir: string; socket: string; script: string; helper: string } | null = null;
let handler: PromptHandler | null = null;
let nextId = 1;

/** Starts the socket and writes the helper scripts; call once at startup. */
export function startAskpass(onPrompt: PromptHandler): void {
  handler = onPrompt;
  if (server) return;

  const dir = join(tmpdir(), `agentpov-askpass-${userInfo().uid}-${process.pid}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const helper = join(dir, "askpass.js");
  const script = join(dir, "askpass.sh");
  const socket = join(dir, "s");
  writeFileSync(helper, HELPER_JS, { mode: 0o600 });
  writeFileSync(
    script,
    `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "$AGENTPOV_ASKPASS_NODE" "${helper}" "$@"\n`,
  );
  chmodSync(script, 0o700);
  rmSync(socket, { force: true });
  paths = { dir, socket, script, helper };

  server = createServer((connection) => {
    let request = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk: string) => {
      request += chunk;
      const newline = request.indexOf("\n");
      if (newline === -1) return;
      let parsed: { host?: string; window?: string; prompt?: string } = {};
      try {
        parsed = JSON.parse(request.slice(0, newline)) as typeof parsed;
      } catch {
        // Fall through with an empty prompt; the user can still cancel.
      }
      const prompt: SshPrompt = {
        id: nextId++,
        host: parsed.host ?? "",
        message: parsed.prompt ?? "",
      };
      const windowId = parsed.window ? Number(parsed.window) : null;
      const answer = handler ? handler(prompt, windowId) : Promise.resolve(null);
      answer
        .catch(() => null)
        .then((value) => connection.end(JSON.stringify({ value })));
    });
    connection.on("error", () => {});
  });
  // Without the bridge ssh still works for key-agent logins; askpassEnv then
  // tells it never to prompt. A listen failure must not take the app down.
  server.on("error", () => stopAskpass());
  server.listen(socket);
}

export function stopAskpass(): void {
  server?.close();
  server = null;
  if (paths) rmSync(paths.dir, { recursive: true, force: true });
  paths = null;
}

/** Environment that routes ssh's prompts for `host` through the bridge. */
export function askpassEnv(host: string, windowId: number | null): Record<string, string> {
  if (!paths) return { SSH_ASKPASS_REQUIRE: "never" };
  return {
    SSH_ASKPASS: paths.script,
    SSH_ASKPASS_REQUIRE: "force",
    // Older OpenSSH only consults SSH_ASKPASS when DISPLAY is set.
    DISPLAY: process.env["DISPLAY"] ?? "agentpov:0",
    AGENTPOV_ASKPASS_SOCK: paths.socket,
    AGENTPOV_ASKPASS_NODE: process.execPath,
    AGENTPOV_ASKPASS_HOST: host,
    AGENTPOV_ASKPASS_WINDOW: windowId === null ? "" : String(windowId),
  };
}
