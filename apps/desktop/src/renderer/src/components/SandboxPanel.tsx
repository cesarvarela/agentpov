import { Badge } from "@agentpov/ui";
import type {
  PermissionDecision,
  SandboxListItem,
  SandboxPathRule,
  SandboxSummary,
  TargetKind,
} from "@agentpov/core";

import { layerLabel, settingProvenance } from "../lib/derive";
import { rowPath } from "../lib/paths";
import type { SourceTarget } from "../hooks/useSource";
import {
  DECISION_VARIANT,
  EmptyRow,
  OffNote,
  Panel,
  RowButton,
  SectionDivider,
  SettingChip,
  settingSource,
} from "./ContextPanels";
import { SandboxIcon } from "./Icons";

/**
 * The Bash sandbox, kept apart from the Permissions panel on purpose: it
 * restricts only Bash commands (and their children), never Read, Edit or
 * Write, so its verdicts must not be read as the file's permission verdicts.
 *
 * Its read/write verdicts reuse the allow/deny pills — they mean the same
 * thing, whether an access goes through — but every row says "Bash".
 */

const ACCESS: Record<"allowed" | "denied", PermissionDecision> = {
  allowed: "allow",
  denied: "deny",
};

/** Which access a path list governs, and which decision it hands out. */
const PATH_KIND = {
  allowRead: { access: "read", decision: "allow" },
  denyRead: { access: "read", decision: "deny" },
  allowWrite: { access: "write", decision: "allow" },
  denyWrite: { access: "write", decision: "deny" },
} as const satisfies Record<
  SandboxPathRule["kind"],
  { access: "read" | "write"; decision: PermissionDecision }
>;

/** The matching path rule that decided `access`, if a rule (not a default) did. */
function decidingRule(
  rules: SandboxPathRule[],
  access: "read" | "write",
  verdict: "allowed" | "denied",
): SandboxPathRule | undefined {
  const decision = ACCESS[verdict];
  return rules.find(
    (rule) =>
      rule.matchesTarget &&
      !rule.ignored &&
      PATH_KIND[rule.kind].access === access &&
      PATH_KIND[rule.kind].decision === decision,
  );
}

function ruleTarget(rule: SandboxPathRule, key: string): SourceTarget {
  return {
    key,
    path: rule.path,
    layer: rule.layer,
    matches: [`"${rule.fromPermission ?? rule.pattern}"`, rule.pattern],
  };
}

/**
 * Core writes one sentence per access, `Read: … . Write: … .`; each verdict
 * row gets its own half. Falls back to the whole line.
 */
function accessReason(reason: string, access: "read" | "write"): string {
  const match = /^Read: (.*?)\. Write: (.*?)\.?$/s.exec(reason.trim());
  if (!match) return reason;
  return (access === "read" ? match[1] : match[2]) ?? reason;
}

function listText(items: SandboxListItem[]): string {
  return items
    .filter((item) => !item.ignored)
    .map((item) => item.value)
    .join(", ");
}

export function SandboxPanel({
  sandbox,
  targetKind,
  folder,
  homeDir,
  activeSourceKey,
  onOpenSource,
}: {
  sandbox: SandboxSummary | undefined;
  targetKind: TargetKind;
  folder: string;
  homeDir: string;
  activeSourceKey: string | null;
  onOpenSource: (target: SourceTarget) => void;
}) {
  // Nothing to say when nobody configured it: the default is off.
  if (!sandbox || (!sandbox.enabled.value && !sandbox.enabled.source)) return null;

  const enabledTarget = settingSource(sandbox.enabled, "sandbox:enabled");
  const here = targetKind === "directory" ? "in this folder" : "this file";

  if (!sandbox.enabled.value) {
    return (
      <Panel
        icon={<SandboxIcon className="text-om-muted" />}
        title="Bash sandbox"
        note={settingProvenance(sandbox.enabled, folder, homeDir)}
      >
        <RowButton
          active={activeSourceKey === "sandbox:enabled"}
          height="h-[30px]"
          onClick={() => enabledTarget && onOpenSource(enabledTarget)}
        >
          <span className="text-om-muted text-[11px]">
            Off. Bash commands run unsandboxed, under permission rules only.
          </span>
        </RowButton>
      </Panel>
    );
  }

  const rules = [...sandbox.filesystem].sort(
    (a, b) => Number(b.matchesTarget) - Number(a.matchesTarget),
  );
  const verdicts = sandbox.target
    ? (["read", "write"] as const).map((access) => {
        const verdict = sandbox.target![access];
        return {
          access,
          verdict,
          rule: decidingRule(rules, access, verdict),
        };
      })
    : [];

  const flags = [
    {
      id: "autoAllowBashIfSandboxed",
      label: "auto-allow Bash",
      setting: sandbox.autoAllowBashIfSandboxed,
    },
    {
      id: "allowUnsandboxedCommands",
      label: "unsandboxed retry",
      setting: sandbox.allowUnsandboxedCommands,
    },
    ...(sandbox.filesystemDisabled?.value
      ? [
          {
            id: "filesystemDisabled",
            label: "filesystem isolation",
            setting: { ...sandbox.filesystemDisabled, value: false },
          },
        ]
      : []),
  ];
  const excluded = listText(sandbox.excludedCommands);
  const allowed = listText(sandbox.allowedDomains);
  const denied = listText(sandbox.deniedDomains);

  return (
    <Panel
      icon={<SandboxIcon className="text-om-muted" />}
      title="Bash sandbox"
      note="Bash commands only · Read, Edit and Write follow permission rules"
    >
      {verdicts.map(({ access, verdict, rule }) => {
        const key = `sandbox:verdict:${access}`;
        const explanation = sandbox.target
          ? accessReason(sandbox.target.reason, access)
          : "";
        const target = rule ? ruleTarget(rule, key) : enabledTarget;
        const body = (
          <>
            <Badge
              variant={DECISION_VARIANT[ACCESS[verdict]]}
              className="w-[46px] shrink-0 justify-center"
            >
              {ACCESS[verdict]}
            </Badge>
            <span className="shrink-0 font-mono text-xs">Bash {access}</span>
            <span className="text-om-muted shrink-0 text-[11px]">{here}</span>
            <span
              className="text-om-muted min-w-0 flex-1 truncate text-right text-[11px]"
              title={explanation}
            >
              {explanation}
            </span>
          </>
        );
        return target ? (
          <RowButton
            key={key}
            active={activeSourceKey === target.key}
            height="h-[30px]"
            title={sandbox.target?.reason}
            onClick={() => onOpenSource(target)}
          >
            {body}
          </RowButton>
        ) : (
          <div
            key={key}
            className="border-om-border/60 flex h-[30px] items-center gap-2.5 border-t px-3 first:border-t-0"
            title={sandbox.target?.reason}
          >
            {body}
          </div>
        );
      })}

      <div className="border-om-border/60 flex flex-wrap items-center gap-1.5 border-t px-3 py-1.5">
        {flags.map((flag) => {
          const key = `sandbox:${flag.id}`;
          const target = settingSource(flag.setting, key);
          return (
            <SettingChip
              key={flag.id}
              label={flag.label}
              value={flag.setting.value ? "on" : "off"}
              title={settingProvenance(flag.setting, folder, homeDir)}
              active={activeSourceKey === key}
              onOpen={target ? () => onOpenSource(target) : undefined}
            />
          );
        })}
      </div>

      <SectionDivider label="paths" />
      {rules.length === 0 ? (
        <EmptyRow text="No sandbox path rules; writes stay inside the project." />
      ) : (
        rules.map((rule, index) => {
          const key = `sandbox:path:${rule.path}:${rule.kind}:${rule.pattern}:${index}`;
          const kind = PATH_KIND[rule.kind];
          return (
            <RowButton
              key={key}
              active={activeSourceKey === key}
              dim={rule.ignored !== undefined}
              height="h-[30px]"
              title={rule.ignored ? `ignored: ${rule.ignored}` : rule.resolved}
              onClick={() => onOpenSource(ruleTarget(rule, key))}
            >
              <Badge
                variant={DECISION_VARIANT[kind.decision]}
                className="w-[46px] shrink-0 justify-center"
              >
                {kind.access}
              </Badge>
              <span
                className={`min-w-0 flex-1 truncate font-mono text-xs ${
                  rule.ignored ? "text-om-muted line-through" : ""
                }`}
              >
                {rule.pattern}
                {rule.fromPermission ? (
                  <span className="text-om-muted"> from {rule.fromPermission}</span>
                ) : rule.fromCredentials ? (
                  <span className="text-om-muted"> credentials ({rule.fromCredentials})</span>
                ) : null}
              </span>
              <Badge className="w-[66px] shrink-0 justify-center">
                {layerLabel(rule.layer)}
              </Badge>
              {rule.ignored ? (
                <OffNote text={`ignored: ${rule.ignored}`} />
              ) : rule.matchesTarget ? (
                <span
                  className={`shrink-0 text-[11px] ${
                    kind.decision === "deny" ? "text-om-deny" : "text-om-allow"
                  }`}
                >
                  {targetKind === "directory" ? "matches this folder" : "matches this file"}
                </span>
              ) : (
                <span className="text-om-muted max-w-[35%] shrink-0 truncate font-mono text-[11px]">
                  {rowPath(rule.path, folder, homeDir)}
                </span>
              )}
            </RowButton>
          );
        })
      )}

      {excluded || allowed || denied ? (
        <>
          <SectionDivider label="commands and network" />
          {excluded ? <ListRow label="excluded" value={excluded} /> : null}
          {allowed ? <ListRow label="domains allowed" value={allowed} /> : null}
          {denied ? <ListRow label="domains denied" value={denied} /> : null}
        </>
      ) : null}
    </Panel>
  );
}

function ListRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-om-border/60 flex h-[30px] items-center gap-2.5 border-t px-3 first:border-t-0">
      <span className="text-om-muted w-[104px] shrink-0 text-[11px]">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={value}>
        {value}
      </span>
    </div>
  );
}
