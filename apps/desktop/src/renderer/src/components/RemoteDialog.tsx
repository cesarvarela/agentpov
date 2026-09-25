import { useEffect, useMemo, useState } from "react";
import { Button } from "@agentpov/ui";

import type { RemoteInfo } from "../../../shared/ipc";
import { errorMessage } from "../lib/errors";
import { displayPath } from "../lib/paths";
import type { RecentProject } from "../lib/recents";
import { ServerIcon } from "./Icons";
import { inputClass, Modal } from "./Modal";

interface RemoteDialogProps {
  /** Recent projects; the remote ones are offered first and prefill the folder. */
  recents: RecentProject[];
  onOpen: (host: string, path: string) => Promise<void>;
  onClose: () => void;
}

type Step =
  | { kind: "host" }
  | { kind: "connecting"; host: string }
  | { kind: "path"; info: RemoteInfo };

/** Pick an SSH host, connect, then pick a folder on it. */
export function RemoteDialog({
  recents,
  onOpen,
  onClose,
}: RemoteDialogProps) {
  const api = window.agentpov;
  const [step, setStep] = useState<Step>({ kind: "host" });
  const [hostInput, setHostInput] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [configHosts, setConfigHosts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const recent = useMemo(
    () => recents.filter((r): r is RecentProject & { host: string } => r.host !== null),
    [recents],
  );

  useEffect(() => {
    api?.listSshHosts().then(setConfigHosts).catch(() => {});
  }, [api]);

  /** Recent hosts first, then ~/.ssh/config hosts, filtered by the input. */
  const suggestions = useMemo(() => {
    const all = [...new Set([...recent.map((r) => r.host), ...configHosts])];
    const query = hostInput.trim().toLowerCase();
    return query ? all.filter((host) => host.toLowerCase().includes(query)) : all;
  }, [recent, configHosts, hostInput]);

  const connect = async (host: string) => {
    const target = host.trim();
    if (!api || !target) return;
    setError(null);
    setStep({ kind: "connecting", host: target });
    try {
      const info = await api.connectRemote(target);
      const remembered = recent.find((r) => r.host === target);
      // No "~" default: listing the whole remote home is slow and rarely wanted.
      setPathInput(remembered ? displayPath(remembered.path, null, info.homeDir) : "");
      setStep({ kind: "path", info });
    } catch (cause) {
      setError(errorMessage(cause));
      setHostInput(target);
      setStep({ kind: "host" });
    }
  };

  const open = async () => {
    if (step.kind !== "path" || opening) return;
    setOpening(true);
    setError(null);
    try {
      await onOpen(step.info.host, pathInput);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOpening(false);
    }
  };

  const errorLine = error ? (
    <p className="text-om-deny whitespace-pre-wrap font-mono text-[11px]">{error}</p>
  ) : null;

  if (step.kind === "path") {
    return (
      <Modal
        title="Open remote folder"
        onClose={onClose}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setStep({ kind: "host" })}>
              Back
            </Button>
            <Button variant="outline" size="sm" disabled={opening || !pathInput.trim()} onClick={() => void open()}>
              {opening ? "Opening…" : "Open"}
            </Button>
          </>
        }
      >
        <p className="text-om-muted flex items-center gap-2 text-xs">
          <ServerIcon className="size-3.5 shrink-0" />
          Connected to <span className="text-om-text font-mono">{step.info.host}</span>
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-om-muted text-[11px]">Folder on {step.info.host}</span>
          <input
            autoFocus
            className={inputClass}
            value={pathInput}
            spellCheck={false}
            placeholder="~/projects/app"
            onChange={(event) => setPathInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void open();
            }}
          />
        </label>
        <p className="text-om-muted text-[11px]">
          ~ is {step.info.homeDir}
        </p>
        {errorLine}
      </Modal>
    );
  }

  const connecting = step.kind === "connecting";

  return (
    <Modal
      title="Open remote folder"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={connecting || !hostInput.trim()}
            onClick={() => void connect(hostInput)}
          >
            {connecting ? "Connecting…" : "Connect"}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-om-muted text-[11px]">SSH host</span>
        <input
          autoFocus
          className={inputClass}
          value={hostInput}
          disabled={connecting}
          spellCheck={false}
          placeholder="alias from ~/.ssh/config or user@host"
          onChange={(event) => setHostInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void connect(hostInput);
          }}
        />
      </label>

      {connecting ? (
        <p className="text-om-muted text-xs">Connecting to {step.host}…</p>
      ) : suggestions.length > 0 ? (
        <ul className="border-om-border max-h-[220px] overflow-y-auto rounded-md border py-1">
          {suggestions.map((host) => (
            <li key={host}>
              <button
                type="button"
                onClick={() => void connect(host)}
                className="hover:bg-om-raised flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left transition-colors"
              >
                <ServerIcon className="text-om-muted size-3.5 shrink-0" />
                <span className="font-mono text-xs">{host}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {errorLine}
    </Modal>
  );
}
