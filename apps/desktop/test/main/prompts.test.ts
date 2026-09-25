import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import type { SshPrompt } from "../../src/shared/ipc";
import { PromptBroker, type PromptTarget } from "../../src/main/ssh/prompts";

/** Stands in for a window's WebContents: records what it was sent. */
class FakeWindow extends EventEmitter implements PromptTarget {
  sent: SshPrompt[] = [];

  send(_channel: "ssh:prompt", prompt: SshPrompt): void {
    this.sent.push(prompt);
  }

  navigate(details: { isMainFrame: boolean; isSameDocument: boolean }): void {
    this.emit("did-start-navigation", details);
  }

  listeners_(): number {
    return (
      this.listenerCount("destroyed") +
      this.listenerCount("render-process-gone") +
      this.listenerCount("did-start-navigation")
    );
  }
}

const prompt = (id: number): SshPrompt => ({ id, host: "db", message: "Password:" });

describe("PromptBroker", () => {
  it("sends the prompt to the window and resolves with its answer", async () => {
    const broker = new PromptBroker();
    const window = new FakeWindow();

    const answer = broker.ask(window, prompt(1));
    broker.answer(1, "hunter2");

    expect(window.sent).toEqual([prompt(1)]);
    await expect(answer).resolves.toBe("hunter2");
  });

  it("resolves null at once when there is no window to ask", async () => {
    await expect(new PromptBroker().ask(undefined, prompt(1))).resolves.toBeNull();
  });

  it.each([
    ["closes", (w: FakeWindow) => w.emit("destroyed")],
    ["crashes", (w: FakeWindow) => w.emit("render-process-gone")],
    ["reloads", (w: FakeWindow) => w.navigate({ isMainFrame: true, isSameDocument: false })],
  ])("cancels the prompt when the window %s", async (_name, event) => {
    const broker = new PromptBroker();
    const window = new FakeWindow();

    const answer = broker.ask(window, prompt(1));
    event(window);

    await expect(answer).resolves.toBeNull();
  });

  it("keeps waiting through in-page and subframe navigations", async () => {
    const broker = new PromptBroker();
    const window = new FakeWindow();

    const answer = broker.ask(window, prompt(1));
    window.navigate({ isMainFrame: true, isSameDocument: true });
    window.navigate({ isMainFrame: false, isSameDocument: false });
    broker.answer(1, "still here");

    await expect(answer).resolves.toBe("still here");
  });

  it("detaches from the window once answered, and ignores late answers", async () => {
    const broker = new PromptBroker();
    const window = new FakeWindow();

    const answer = broker.ask(window, prompt(1));
    broker.answer(1, "first");
    broker.answer(1, "second");
    window.emit("destroyed");

    await expect(answer).resolves.toBe("first");
    expect(window.listeners_()).toBe(0);
  });

  it("detaches after a cancel too", async () => {
    const broker = new PromptBroker();
    const window = new FakeWindow();

    const answer = broker.ask(window, prompt(1));
    window.emit("destroyed");
    await answer;

    expect(window.listeners_()).toBe(0);
  });

  it("keeps concurrent prompts apart and only cancels the closed window's", async () => {
    const broker = new PromptBroker();
    const a = new FakeWindow();
    const b = new FakeWindow();

    const fromA = broker.ask(a, prompt(1));
    const fromB = broker.ask(b, prompt(2));
    a.emit("destroyed");
    broker.answer(2, "for b");
    broker.answer(99, "unknown id");

    await expect(fromA).resolves.toBeNull();
    await expect(fromB).resolves.toBe("for b");
  });
});
