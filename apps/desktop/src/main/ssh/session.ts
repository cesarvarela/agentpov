import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import { userInfo } from "node:os";

import { READ_FILE_MAX_BYTES, type RemoteInfo } from "../../shared/ipc";
import { MAX_DEPTH, SKIP_DIRS } from "../tree";
import { askpassEnv } from "./askpass";

/**
 * One SSH host, reached through the system `ssh` binary.
 *
 * A single long-lived `ssh host sh` process runs a small read loop on the
 * remote side: we write one request per line, it answers one line per request.
 * That keeps each read to one network round trip with no process spawn. The
 * connection is shared through ControlMaster, so reconnecting after the loop
 * dies (or a second window) skips authentication while the master is alive.
 */

/** Cached reads stay valid this long, so clicking around re-uses them. */
const CACHE_TTL_MS = 5_000;

/**
 * The remote read loop. Requests are `op<TAB>path`; responses are
 * `ok<TAB>...` or `missing<TAB>`, with file contents and listings base64
 * encoded so every response is exactly one line. POSIX sh only.
 */
const REMOTE_SCRIPT = `
b64() { base64 | tr -d '\\n'; }
printf 'ready\\t%s\\t%s\\n' "$HOME" "$(uname -s)"
while IFS= read -r line; do
  op=\${line%%\t*}
  p=\${line#*\t}
  case $op in
    read)
      if [ -f "$p" ] && [ -r "$p" ]; then printf 'ok\\t'; b64 < "$p"; printf '\\n'
      else printf 'missing\\t\\n'; fi ;;
    size)
      if [ -f "$p" ]; then printf 'ok\\t%s\\n' "$(wc -c < "$p" | tr -d ' ')"
      else printf 'missing\\t\\n'; fi ;;
    head)
      if [ -f "$p" ] && [ -r "$p" ]; then
        printf 'ok\\t%s\\t' "$(wc -c < "$p" | tr -d ' ')"
        head -c ${READ_FILE_MAX_BYTES} "$p" | b64; printf '\\n'
      else printf 'missing\\t\\n'; fi ;;
    isdir)
      if [ -d "$p" ]; then printf 'ok\\t\\n'; else printf 'missing\\t\\n'; fi ;;
    list)
      if [ -d "$p" ] && [ -r "$p" ]; then
        printf 'ok\\t'
        find "$p" -mindepth 1 -maxdepth 1 \\( -type d -exec printf 'd\\t%s\\n' {} + \\) -o -exec printf 'f\\t%s\\n' {} + 2>/dev/null | b64
        printf '\\n'
      else printf 'missing\\t\\n'; fi ;;
    tree)
      if [ -d "$p" ]; then
        printf 'ok\\t'
        find "$p" -mindepth 1 -maxdepth ${MAX_DEPTH} \\
          \\( -type d \\( ${[...SKIP_DIRS].map((name) => `-name '${name}'`).join(" -o ")} \\) -prune \\) \\
          -o \\( -type d -exec printf 'd\\t%s\\n' {} + \\) \\
          -o \\( -type f -exec printf 'f\\t%s\\n' {} + \\) 2>/dev/null | b64
        printf '\\n'
      else printf 'missing\\t\\n'; fi ;;
    *) printf 'error\\tunknown op\\n' ;;
  esac
done
`;

export type RemoteOp = "read" | "size" | "head" | "isdir" | "list" | "tree";

export type { RemoteInfo };

/** Socket directory; kept short because ControlPath is capped near 104 bytes. */
function controlDir(): string {
  const dir = `/tmp/agentview-${userInfo().uid}`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function platformFromUname(uname: string): NodeJS.Platform {
  const name = uname.trim().toLowerCase();
  if (name === "darwin") return "darwin";
  if (name === "linux") return "linux";
  if (name.includes("freebsd")) return "freebsd";
  if (name.includes("openbsd")) return "openbsd";
  return "linux";
}

function sshArgs(host: string): string[] {
  return [
    "-T",
    "-o", "ControlMaster=auto",
    "-o", `ControlPath=${controlDir()}/%C`,
    "-o", "ControlPersist=15m",
    "-o", "ConnectTimeout=15",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    host,
  ];
}

/** The remote command, safe to pass through any login shell (sh, zsh, fish). */
function remoteCommand(): string {
  const encoded = Buffer.from(REMOTE_SCRIPT, "utf8").toString("base64");
  return `/bin/sh -c 'eval "$(printf %s ${encoded} | base64 -d)"'`;
}

interface Pending {
  resolve: (fields: string[] | null) => void;
  reject: (error: Error) => void;
}

/** Last lines of ssh's stderr, which carry the useful part of a failure. */
function stderrTail(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("Warning: Permanently added"));
  return lines.slice(-3).join("\n");
}

export class RemoteHost {
  readonly host: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<RemoteInfo> | null = null;
  private info: RemoteInfo | null = null;
  private queue: Pending[] = [];
  /** Pieces of the stdout line still waiting for its newline. */
  private partial: string[] = [];
  private cache = new Map<string, Promise<string[] | null>>();
  /** Window whose request (re)starts the connection; ssh prompts go to it. */
  private requester: number | null = null;

  constructor(host: string) {
    // ssh reads a leading "-" as an option (-oProxyCommand=… runs a command).
    if (!host || host.startsWith("-") || /\s/.test(host)) {
      throw new Error(`Not an SSH host: ${host}`);
    }
    this.host = host;
  }

  /**
   * Opens the read loop (authenticating if needed) and returns the remote's
   * home and OS. `windowId` is the window to ask if ssh needs a password.
   */
  connect(windowId?: number): Promise<RemoteInfo> {
    if (windowId !== undefined) this.requester = windowId;
    if (!this.ready) this.ready = this.start();
    return this.ready;
  }

  private start(): Promise<RemoteInfo> {
    return new Promise<RemoteInfo>((resolve, reject) => {
      const child = spawn("ssh", [...sshArgs(this.host), remoteCommand()], {
        env: { ...process.env, ...askpassEnv(this.host, this.requester) },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      this.partial = [];
      let stderr = "";
      let started = false;

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.stdout.setEncoding("utf8");
      const onLine = (line: string) => {
        if (!started) {
          // Login banners or rc-file noise can precede the handshake.
          if (!line.startsWith("ready\t")) return;
          const [, homeDir = "", uname = ""] = line.split("\t");
          started = true;
          this.info = {
            host: this.host,
            homeDir,
            platform: platformFromUname(uname),
          };
          resolve(this.info);
          return;
        }
        this.answer(line);
      };

      // A tree or file response is one line that can span many MB; collect its
      // chunks and join once, instead of rescanning a growing string per chunk.
      child.stdout.on("data", (chunk: string) => {
        let start = 0;
        let newline: number;
        while ((newline = chunk.indexOf("\n", start)) !== -1) {
          this.partial.push(chunk.slice(start, newline));
          const line = this.partial.join("");
          this.partial = [];
          start = newline + 1;
          onLine(line);
        }
        if (start < chunk.length) this.partial.push(chunk.slice(start));
      });

      const fail = (message: string) => {
        const error = new Error(message);
        if (!started) reject(error);
        for (const pending of this.queue.splice(0)) pending.reject(error);
        if (this.child === child) {
          this.child = null;
          this.ready = null;
          this.cache.clear();
        }
      };

      child.on("error", (error) => fail(`Could not run ssh: ${error.message}`));
      child.on("close", (code) => {
        const detail = stderrTail(stderr);
        fail(
          detail ||
            (started
              ? `Connection to ${this.host} closed`
              : `ssh exited with code ${code ?? "?"} before connecting`),
        );
      });
    });
  }

  private answer(line: string): void {
    const pending = this.queue.shift();
    if (!pending) return;
    const [status, ...fields] = line.split("\t");
    if (status === "ok") pending.resolve(fields);
    else if (status === "missing") pending.resolve(null);
    else pending.reject(new Error(fields.join(" ") || "Remote read failed"));
  }

  /**
   * One request to the read loop; null when the path is missing or unreadable.
   * `windowId` is the window asking, in case the request has to reconnect.
   */
  async request(
    op: RemoteOp,
    path: string,
    { cached = true, windowId }: { cached?: boolean; windowId?: number } = {},
  ): Promise<string[] | null> {
    if (path.includes("\n")) return null;
    const key = `${op}\t${path}`;
    const hit = cached ? this.cache.get(key) : undefined;
    if (hit) return hit;

    const value = this.send(op, path, windowId);
    if (cached) {
      this.cache.set(key, value);
      const drop = () => {
        if (this.cache.get(key) === value) this.cache.delete(key);
      };
      setTimeout(drop, CACHE_TTL_MS).unref();
      value.catch(drop);
    }
    return value;
  }

  private async send(op: RemoteOp, path: string, windowId?: number): Promise<string[] | null> {
    await this.connect(windowId);
    const child = this.child;
    if (!child) throw new Error(`Not connected to ${this.host}`);
    return new Promise<string[] | null>((resolve, reject) => {
      this.queue.push({ resolve, reject });
      child.stdin.write(`${op}\t${path}\n`);
    });
  }

  /** Ends the read loop and the shared master connection. */
  close(): void {
    this.child?.stdin.end();
    this.child = null;
    this.ready = null;
    this.cache.clear();
    spawn("ssh", ["-o", `ControlPath=${controlDir()}/%C`, "-O", "exit", this.host], {
      stdio: "ignore",
    }).on("error", () => {});
  }
}

export function decode(field: string | undefined): string {
  return Buffer.from(field ?? "", "base64").toString("utf8");
}

/** Parses `d<TAB>path` / `f<TAB>path` lines from `list` and `tree`. */
export function parseEntries(field: string | undefined): { path: string; isDirectory: boolean }[] {
  return decode(field)
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ isDirectory: line.startsWith("d\t"), path: line.slice(2) }));
}
