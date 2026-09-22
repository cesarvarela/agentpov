import { useEffect, useRef, useState } from "react";

import { ChevronRightIcon } from "../components/Icons";
import { basename, displayPath } from "../lib/paths";
import { JsonTree } from "./JsonViewer";
import {
  Card,
  ParseFailure,
  Section,
  ValueTable,
  hitsExactly,
  isRecord,
  parseJson,
} from "./shared";
import type { ViewerProps } from "./types";

/**
 * Rendered view of a file that declares MCP servers: `<folder>/.mcp.json` or
 * `~/.claude.json` (root `mcpServers` plus `projects.<folder>.mcpServers`).
 *
 * When the row that opened the file names one server, that server is the view:
 * its card sits expanded at the top and the rest collapse into a muted list.
 * Env and header *values* are only ever shown when their key does not name a
 * credential — see `MaskedValue`.
 */

/** Fields the card spells out; anything else falls through to the tree. */
const SERVER_FIELDS = new Set([
  "type",
  "url",
  "command",
  "args",
  "env",
  "headers",
]);

/** A scope label longer than this is worse than no label at all in ~380px. */
const MAX_SCOPE_LABEL = 40;

interface Server {
  /** Unique across the file, so two projects can declare the same name. */
  id: string;
  name: string;
  config: Record<string, unknown>;
  /** Which `projects` key declared it; absent for the root `mcpServers`. */
  scope: string | null;
}

/**
 * Transport, read the way core's discovery does: an explicit `type` wins, then
 * a `url` means http, then a `command` means stdio.
 */
function transportOf(config: Record<string, unknown>): string | null {
  const type = config["type"];
  if (type === "http" || type === "sse" || type === "stdio") return type;
  if (typeof config["url"] === "string") return "http";
  if (typeof config["command"] === "string") return "stdio";
  return null;
}

/** The command line or the endpoint — whichever this server is reached by. */
function targetOf(config: Record<string, unknown>): string | null {
  const url = config["url"];
  if (typeof url === "string") return url;
  const command = config["command"];
  if (typeof command !== "string") return null;
  const args = Array.isArray(config["args"])
    ? config["args"].filter((arg): arg is string => typeof arg === "string")
    : [];
  return [command, ...args].join(" ");
}

/** Servers under `root.mcpServers`, then under each `root.projects.*`. */
function collectServers(
  root: Record<string, unknown>,
  folder: string,
  homeDir: string,
): Server[] {
  const out: Server[] = [];
  const push = (map: unknown, scope: string | null) => {
    if (!isRecord(map)) return;
    for (const [name, raw] of Object.entries(map)) {
      out.push({
        id: `${out.length}:${name}`,
        name,
        config: isRecord(raw) ? raw : {},
        scope,
      });
    }
  };

  push(root["mcpServers"], null);

  const projects = root["projects"];
  if (isRecord(projects)) {
    for (const [key, value] of Object.entries(projects)) {
      if (!isRecord(value)) continue;
      push(value["mcpServers"], scopeLabel(key, folder, homeDir));
    }
  }
  return out;
}

/** A project key as a short human path, falling back to the key itself. */
function scopeLabel(key: string, folder: string, homeDir: string): string {
  const shown = displayPath(key, folder, homeDir);
  return shown.length <= MAX_SCOPE_LABEL ? shown : key;
}

function ScopeLabel({ scope }: { scope: string | null }) {
  if (scope === null) return null;
  return (
    <span className="text-om-muted shrink-0 truncate text-[11px]">{scope}</span>
  );
}

function ServerCard({
  server,
  innerRef,
}: {
  server: Server;
  innerRef?: (node: HTMLDivElement | null) => void;
}) {
  const { config } = server;
  const transport = transportOf(config);
  const target = targetOf(config);
  const env = isRecord(config["env"]) ? config["env"] : undefined;
  const headers = isRecord(config["headers"]) ? config["headers"] : undefined;
  const unknown = Object.fromEntries(
    Object.entries(config).filter(([key]) => !SERVER_FIELDS.has(key)),
  );

  return (
    <Card innerRef={innerRef}>
      <div className="flex items-center gap-2">
        <span className="text-om-text min-w-0 flex-1 truncate font-mono text-xs font-semibold">
          {server.name}
        </span>
        <ScopeLabel scope={server.scope} />
        {transport ? (
          <span className="text-om-muted shrink-0 text-[11px]">
            {transport}
          </span>
        ) : null}
      </div>
      {target ? (
        <code className="text-om-muted font-mono text-[11px] leading-[16px] break-all whitespace-pre-wrap">
          {target}
        </code>
      ) : null}
      {env ? <ValueTable label="env" values={env} /> : null}
      {headers ? <ValueTable label="headers" values={headers} /> : null}
      {Object.keys(unknown).length > 0 ? (
        <JsonTree value={unknown} depth={1} />
      ) : null}
    </Card>
  );
}

/** A disclosure for keys the viewer has no opinion about. */
function OtherKeys({
  keys,
  value,
  collapsed,
}: {
  keys: string[];
  value: Record<string, unknown>;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  if (keys.length === 0) return null;

  return (
    <Section label="Other">
      {open ? (
        <JsonTree value={value} depth={1} />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-om-muted hover:text-om-text flex cursor-pointer items-center gap-1 text-left text-[11px]"
        >
          <ChevronRightIcon className="size-3 shrink-0" />
          Other keys ({keys.length})
        </button>
      )}
    </Section>
  );
}

export function McpViewer({
  content,
  path,
  folder,
  homeDir,
  matches,
}: ViewerProps) {
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const matchKey = matches?.join("\n") ?? "";

  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: "center" });
  }, [matchKey, content]);

  const parsed = parseJson(content);
  if (!parsed.ok)
    return <ParseFailure error={parsed.error} content={content} />;
  if (!isRecord(parsed.value)) {
    return (
      <div className="px-3 py-2">
        <JsonTree value={parsed.value} />
      </div>
    );
  }

  const root = parsed.value;
  const servers = collectServers(root, folder, homeDir);
  const rest = Object.fromEntries(
    Object.entries(root).filter(([key]) => key !== "mcpServers"),
  );
  // `~/.claude.json` keeps conversation history and caches next to the servers;
  // rendering those by default would bury the one server the user clicked.
  const isUserConfig = basename(path) === ".claude.json";

  const matched = servers.filter((server) => hitsExactly(server.name, matches));
  const expanded = matched.length > 0 ? matched : servers;

  let claimed = false;
  const claim = (highlighted: boolean) => {
    if (!highlighted || claimed) return undefined;
    claimed = true;
    return (node: HTMLDivElement | null) => {
      highlightRef.current = node;
    };
  };

  return (
    <div className="divide-om-border/60 flex flex-col divide-y">
      <Section label="MCP servers">
        {servers.length === 0 ? (
          <span className="text-om-muted text-[11px]">
            No servers declared.
          </span>
        ) : (
          <div className="flex flex-col gap-1.5">
            {expanded.map((server) => {
              return (
                <ServerCard
                  key={server.id}
                  server={server}
                  innerRef={claim(matched.includes(server))}
                />
              );
            })}
          </div>
        )}
      </Section>


      <OtherKeys
        keys={Object.keys(rest)}
        value={rest}
        collapsed={isUserConfig}
      />
    </div>
  );
}
