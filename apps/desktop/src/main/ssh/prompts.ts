import type { SshPrompt } from "../../shared/ipc";

interface NavigationDetails {
  isMainFrame: boolean;
  isSameDocument: boolean;
}

/** The part of Electron's WebContents a prompt needs; a stub in tests. */
export interface PromptTarget {
  send(channel: "ssh:prompt", prompt: SshPrompt): void;
  on(event: "destroyed" | "render-process-gone", listener: () => void): unknown;
  on(event: "did-start-navigation", listener: (details: NavigationDetails) => void): unknown;
  off(event: "destroyed" | "render-process-gone", listener: () => void): unknown;
  off(event: "did-start-navigation", listener: (details: NavigationDetails) => void): unknown;
}

/**
 * Hands ssh's prompts to a renderer and waits for the answer. A prompt nobody
 * can answer any more (its window closed, crashed or reloaded) resolves as a
 * cancel; otherwise ssh, and every later connect to that host, would wait on
 * it forever.
 */
export class PromptBroker {
  private pending = new Map<number, (value: string | null) => void>();

  /** Shows `prompt` in `target`; resolves with the answer, or null when cancelled. */
  ask(target: PromptTarget | undefined, prompt: SshPrompt): Promise<string | null> {
    return new Promise((resolve) => {
      if (!target) {
        resolve(null);
        return;
      }

      const cancel = () => settle(null);
      const onNavigate = (details: NavigationDetails) => {
        if (details.isMainFrame && !details.isSameDocument) cancel();
      };
      const settle = (value: string | null) => {
        this.pending.delete(prompt.id);
        target.off("destroyed", cancel);
        target.off("render-process-gone", cancel);
        target.off("did-start-navigation", onNavigate);
        resolve(value);
      };

      target.on("destroyed", cancel);
      target.on("render-process-gone", cancel);
      target.on("did-start-navigation", onNavigate);
      this.pending.set(prompt.id, settle);
      target.send("ssh:prompt", prompt);
    });
  }

  /** The renderer's answer to prompt `id`; null cancels it. Unknown ids are ignored. */
  answer(id: number, value: string | null): void {
    this.pending.get(id)?.(value);
  }
}
