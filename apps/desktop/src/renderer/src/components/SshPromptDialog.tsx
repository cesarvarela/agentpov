import { useCallback, useEffect, useState } from "react";
import { Button } from "@agentview/ui";

import type { SshPrompt } from "../../../shared/ipc";
import { inputClass, Modal } from "./Modal";

/** ssh's first-connection question: "Are you sure you want to continue connecting (yes/no/[fingerprint])?" */
function isHostKeyQuestion(message: string): boolean {
  return /\(yes\/no/.test(message);
}

/**
 * Answers the questions ssh asks while connecting (passphrase, password, 2FA
 * code, unknown host key). Prompts queue up; the oldest is shown first.
 */
export function SshPromptDialog() {
  const api = window.agentview;
  const [queue, setQueue] = useState<SshPrompt[]>([]);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!api) return;
    return api.onSshPrompt((prompt) => setQueue((previous) => [...previous, prompt]));
  }, [api]);

  const current = queue[0];

  const answer = useCallback(
    (reply: string | null) => {
      if (!api || !current) return;
      void api.answerSshPrompt(current.id, reply);
      setQueue((previous) => previous.slice(1));
      setValue("");
    },
    [api, current],
  );

  const cancel = useCallback(() => answer(null), [answer]);

  if (!current) return null;

  const title = current.host ? `ssh ${current.host}` : "ssh";
  const message = <p className="whitespace-pre-wrap font-mono text-xs">{current.message.trim()}</p>;

  if (isHostKeyQuestion(current.message)) {
    return (
      <Modal
        title={title}
        onClose={cancel}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={cancel}>
              Cancel
            </Button>
            <Button variant="outline" size="sm" autoFocus onClick={() => answer("yes")}>
              Trust host
            </Button>
          </>
        }
      >
        {message}
      </Modal>
    );
  }

  return (
    <Modal
      title={title}
      onClose={cancel}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="outline" size="sm" onClick={() => answer(value)}>
            Continue
          </Button>
        </>
      }
    >
      {message}
      <input
        autoFocus
        type="password"
        className={inputClass}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") answer(value);
        }}
      />
    </Modal>
  );
}
