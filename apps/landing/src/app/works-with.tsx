"use client";

import { AGENTS } from "@agentpov/ui";
import { useEffect, useState } from "react";

const supported = AGENTS.filter((agent) => agent.supported);
const ROTATE_MS = 2500;

/**
 * "Works with <agent>" badge. Static while one agent is supported; cycles
 * through them once there are more, unless the viewer prefers reduced motion.
 */
export function WorksWith() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (supported.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % supported.length),
      ROTATE_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  const agent = supported[index]!;
  const Logo = agent.Logo;

  return (
    <span className="border-border bg-card text-muted-foreground inline-flex items-center gap-2 rounded-md border px-2.5 py-1 font-mono text-xs">
      Works with
      <span className="sr-only">
        {supported.map((item) => item.name).join(", ")}
      </span>
      <span
        key={agent.id}
        aria-hidden="true"
        className="animate-in fade-in slide-in-from-bottom-1 text-foreground inline-flex items-center gap-1.5 duration-300 motion-reduce:animate-none"
      >
        {Logo ? <Logo className={`size-3.5 ${agent.colorClass ?? ""}`} /> : null}
        {agent.name}
      </span>
    </span>
  );
}
