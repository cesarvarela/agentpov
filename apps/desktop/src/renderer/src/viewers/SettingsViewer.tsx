import { useEffect, useRef } from "react";
import { Badge } from "@agentpov/ui";

import { JsonTree } from "./JsonViewer";
import {
  Card,
  KeyValue,
  MaskedValue,
  MonoChip,
  OpenLink,
  ParseFailure,
  Section,
  SubHeading,
  hits,
  hookScriptPath,
  isRecord,
  parseJson,
  scalarText,
} from "./shared";
import type { ViewerProps } from "./types";

/**
 * Rendered view of a `settings.json` / `settings.local.json` /
 * `managed-settings.json`. The point of it is the hooks section: the raw JSON
 * buries what actually runs under two levels of array, so here each event gets
 * its matcher groups and one card per command.
 *
 * Read-only throughout, and nothing is inferred about precedence — this is one
 * file, not the merged picture the context panels show.
 */

/** Keys this viewer renders itself; the rest fall through to `Other`. */
const HANDLED = new Set([
  "hooks",
  "permissions",
  "env",
  "enableAllProjectMcpServers",
  "enabledMcpjsonServers",
  "disabledMcpjsonServers",
]);

/** Fields a hook card spells out; anything else is listed as key/value. */
const HOOK_FIELDS = new Set(["type", "command", "prompt", "agent", "timeout"]);

const DECISIONS = ["allow", "ask", "deny"] as const;

type Decision = (typeof DECISIONS)[number];

interface HookGroup {
  matcher?: string;
  entries: Record<string, unknown>[];
}

interface HookEvent {
  event: string;
  groups: HookGroup[];
  /** The event's value was not the array of matcher groups it should be. */
  malformed?: true;
}

/**
 * `hooks` as events in file order, each with its matcher groups. Nothing
 * shaped unexpectedly is guessed at — it is flagged instead, so a malformed
 * file never makes the pane lie about what runs, and never hides it either.
 */
function readHooks(value: unknown): HookEvent[] {
  if (!isRecord(value)) return [];

  const out: HookEvent[] = [];
  for (const [event, rawGroups] of Object.entries(value)) {
    if (!Array.isArray(rawGroups)) {
      out.push({ event, groups: [], malformed: true });
      continue;
    }
    const groups: HookGroup[] = [];
    for (const rawGroup of rawGroups) {
      if (!isRecord(rawGroup)) continue;
      const rawEntries = rawGroup["hooks"];
      const entries = Array.isArray(rawEntries)
        ? rawEntries.filter(isRecord)
        : [];
      const matcher = rawGroup["matcher"];
      groups.push(
        typeof matcher === "string" ? { matcher, entries } : { entries },
      );
    }
    out.push({ event, groups });
  }
  return out;
}

/** What the card shows as the hook's body: a command, a prompt or an agent. */
function hookBody(entry: Record<string, unknown>): string {
  for (const field of ["command", "prompt", "agent"]) {
    const value = entry[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function SettingsViewer({
  content,
  folder,
  homeDir,
  matches,
  onOpenPath,
}: ViewerProps) {
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const matchKey = matches?.join("\n") ?? "";

  // Same behaviour as the numbered-line view: whatever the clicked row pointed
  // at is centred when the file opens and whenever the target changes.
  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: "center" });
  }, [matchKey, content]);

  const parsed = parseJson(content);
  if (!parsed.ok) return <ParseFailure error={parsed.error} content={content} />;
  if (!isRecord(parsed.value)) {
    return (
      <div className="px-3 py-2">
        <JsonTree value={parsed.value} />
      </div>
    );
  }

  const root = parsed.value;
  if (Object.keys(root).length === 0) {
    return (
      <p className="text-om-muted px-3 py-2 text-xs">
        No settings in this file.
      </p>
    );
  }

  // The first matching card claims the scroll target; later ones are still
  // tinted but do not move the pane.
  let claimed = false;
  const claim = (highlighted: boolean) => {
    if (!highlighted || claimed) return undefined;
    claimed = true;
    return (node: HTMLDivElement | null) => {
      highlightRef.current = node;
    };
  };

  const events = readHooks(root["hooks"]);

  const permissions = isRecord(root["permissions"]) ? root["permissions"] : {};
  const ruleLists = DECISIONS.map((decision) => ({
    decision,
    rules: stringList(permissions[decision]),
  })).filter((list) => list.rules.length > 0);
  const permissionFacts = (
    [
      ["defaultMode", permissions["defaultMode"]],
      ["additionalDirectories", permissions["additionalDirectories"]],
      [
        "disableBypassPermissionsMode",
        permissions["disableBypassPermissionsMode"],
      ],
    ] as [string, unknown][]
  ).filter(([, value]) => value !== undefined);
  const permissionRest = Object.fromEntries(
    Object.entries(permissions).filter(
      ([key]) =>
        !DECISIONS.includes(key as Decision) &&
        key !== "defaultMode" &&
        key !== "additionalDirectories" &&
        key !== "disableBypassPermissionsMode",
    ),
  );

  const mcpFacts = (
    [
      ["enableAllProjectMcpServers", root["enableAllProjectMcpServers"]],
      ["enabledMcpjsonServers", root["enabledMcpjsonServers"]],
      ["disabledMcpjsonServers", root["disabledMcpjsonServers"]],
    ] as [string, unknown][]
  ).filter(([, value]) => value !== undefined);

  const env = isRecord(root["env"]) ? root["env"] : undefined;

  // A handled key whose value is not the shape it should be still has to be
  // visible somewhere, so it falls through to the generic tree.
  const unusable = new Set<string>(
    ["hooks", "permissions", "env"].filter(
      (key) => root[key] !== undefined && !isRecord(root[key]),
    ),
  );
  const rest = Object.fromEntries(
    Object.entries(root).filter(
      ([key]) => !HANDLED.has(key) || unusable.has(key),
    ),
  );

  return (
    <div className="divide-om-border/60 flex flex-col divide-y">
      {events.length > 0 ? (
        <Section label="Hooks">
          <div className="flex flex-col gap-2.5">
            {events.map(({ event, groups, malformed }) => (
              <div key={event} className="flex flex-col gap-1.5">
                <SubHeading>{event}</SubHeading>
                {malformed ? (
                  <span className="text-om-amber pl-2 text-[11px]">
                    not a list of matcher groups — see the raw file
                  </span>
                ) : null}
                {groups.map((group, groupIndex) => (
                  <div
                    // Matchers repeat across groups, so the index is the only
                    // stable identity a group has.
                    key={`${group.matcher ?? ""}-${groupIndex}`}
                    className="flex flex-col gap-1 pl-2"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-om-muted text-[11px]">matcher</span>
                      {group.matcher === undefined ||
                      group.matcher === "" ||
                      group.matcher === "*" ? (
                        <MonoChip muted>any tool</MonoChip>
                      ) : (
                        <MonoChip>{group.matcher}</MonoChip>
                      )}
                    </div>
                    {group.entries.length === 0 ? (
                      <span className="text-om-muted text-[11px]">
                        no hooks
                      </span>
                    ) : null}
                    {group.entries.map((entry, entryIndex) => {
                      const body = hookBody(entry);
                      const type =
                        typeof entry["type"] === "string"
                          ? entry["type"]
                          : "command";
                      const timeout = entry["timeout"];
                      const script =
                        type === "command" && body.length > 0
                          ? hookScriptPath(body, folder, homeDir)
                          : null;
                      const extras = Object.entries(entry).filter(
                        ([key]) => !HOOK_FIELDS.has(key),
                      );
                      const highlighted = hits(body, matches);

                      return (
                        <Card
                          key={`${type}-${entryIndex}-${body.slice(0, 32)}`}
                          highlighted={highlighted}
                          innerRef={claim(highlighted)}
                        >
                          {type === "command" ? null : (
                            <span className="text-om-muted text-[11px]">
                              {type}
                            </span>
                          )}
                          <div className="flex items-start gap-2">
                            <code className="text-om-text min-w-0 flex-1 font-mono text-[11px] leading-[16px] break-all whitespace-pre-wrap">
                              {body.length > 0 ? body : "(no command)"}
                            </code>
                            {script ? (
                              <OpenLink onClick={() => onOpenPath(script)} />
                            ) : null}
                          </div>
                          {typeof timeout === "number" ? (
                            <span className="text-om-muted text-[11px]">
                              timeout {timeout}s
                            </span>
                          ) : null}
                          {extras.map(([key, value]) => (
                            <KeyValue key={key} label={key}>
                              {scalarText(value)}
                            </KeyValue>
                          ))}
                        </Card>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {ruleLists.length > 0 ||
      permissionFacts.length > 0 ||
      Object.keys(permissionRest).length > 0 ? (
        <Section label="Permissions">
          <div className="flex flex-col gap-2">
            {ruleLists.map(({ decision, rules }) => (
              <div key={decision} className="flex flex-col gap-1">
                {rules.map((rule, index) => {
                  const highlighted = hits(rule, matches);
                  return (
                    <div
                      // Duplicate rules in one list are legal; index keeps them apart.
                      key={`${rule}-${index}`}
                      ref={claim(highlighted)}
                      className={`flex items-center gap-2 rounded-[4px] border px-1.5 py-0.5 ${
                        highlighted
                          ? "bg-om-amber/12 border-om-amber"
                          : "border-transparent"
                      }`}
                    >
                      <Badge
                        variant={decision}
                        className="w-[46px] shrink-0 justify-center"
                      >
                        {decision}
                      </Badge>
                      <code className="text-om-text min-w-0 flex-1 font-mono text-[11px] break-all">
                        {rule}
                      </code>
                    </div>
                  );
                })}
              </div>
            ))}
            {permissionFacts.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                {permissionFacts.map(([key, value]) => (
                  <KeyValue key={key} label={key}>
                    {Array.isArray(value)
                      ? stringList(value).join(", ")
                      : scalarText(value)}
                  </KeyValue>
                ))}
              </div>
            ) : null}
            {Object.keys(permissionRest).length > 0 ? (
              <JsonTree value={permissionRest} depth={1} />
            ) : null}
          </div>
        </Section>
      ) : null}

      {mcpFacts.length > 0 ? (
        <Section label="MCP">
          <div className="flex flex-col gap-0.5">
            {mcpFacts.map(([key, value]) => (
              <KeyValue key={key} label={key}>
                {Array.isArray(value)
                  ? stringList(value).join(", ")
                  : scalarText(value)}
              </KeyValue>
            ))}
          </div>
        </Section>
      ) : null}

      {env && Object.keys(env).length > 0 ? (
        <Section label="Env">
          <div className="flex flex-col gap-0.5">
            {Object.entries(env).map(([key, value]) => (
              <KeyValue key={key} label={key}>
                <MaskedValue name={key} value={scalarText(value)} />
              </KeyValue>
            ))}
          </div>
        </Section>
      ) : null}

      {Object.keys(rest).length > 0 ? (
        <Section label="Other">
          <JsonTree value={rest} depth={1} />
        </Section>
      ) : null}
    </div>
  );
}
