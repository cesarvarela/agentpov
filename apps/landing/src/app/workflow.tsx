"use client";

import Image, { type StaticImageData } from "next/image";
import { useState } from "react";

import openProject from "../screenshots/open-project.png";
import pickFile from "../screenshots/pick-file.png";
import readSource from "../screenshots/read-source.png";
import toolbox from "../screenshots/toolbox.png";

interface Step {
  title: string;
  body: string;
  image: StaticImageData;
  alt: string;
}

// Captured from the desktop app pointed at this repository, at 1440×900 @2x.
const steps: Step[] = [
  {
    title: "Open a project",
    body: "Pick a local folder or open one over SSH. The tree marks every file that carries instructions or rules.",
    image: openProject,
    alt: "agentpov with the agentpov repository open and the project menu showing Open folder and Open over SSH",
  },
  {
    title: "Select a file",
    body: "See the instructions, memory, permission rules and hooks that apply to exactly that path, and how each one loads.",
    image: pickFile,
    alt: "The context for packages/core/src/memory.ts: instructions, memory files, permissions and hooks",
  },
  {
    title: "Read the source",
    body: "Click any row to open the file it came from beside the context, rendered or raw, and jump to it in your editor.",
    image: readSource,
    alt: "The project CLAUDE.md opened in the source pane next to the file's context",
  },
  {
    title: "Check the toolbox",
    body: "Every skill, subagent and MCP server available in this folder, grouped by where it was defined.",
    image: toolbox,
    alt: "Skills grouped as personal and synced, followed by subagents and MCP servers",
  },
];

export function Workflow() {
  const [active, setActive] = useState(0);
  const step = steps[active]!;

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>

      <ol className="grid gap-2 sm:grid-cols-4">
        {steps.map((item, index) => {
          const selected = index === active;
          return (
            <li key={item.title}>
              <button
                type="button"
                onClick={() => setActive(index)}
                aria-pressed={selected}
                className={`flex h-full w-full cursor-pointer flex-col gap-1.5 rounded-lg border p-4 text-left transition-colors ${
                  selected
                    ? "border-om-amber-border bg-om-amber-bg"
                    : "border-border bg-card hover:bg-om-raised"
                }`}
              >
                <span
                  className={`font-mono text-xs ${selected ? "text-om-amber" : "text-muted-foreground"}`}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="font-medium">{item.title}</span>
                <span className="text-muted-foreground text-sm">{item.body}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="border-border overflow-hidden rounded-xl border shadow-2xl shadow-black/40">
        <Image
          src={step.image}
          alt={step.alt}
          sizes="(min-width: 1024px) 1024px, 100vw"
          className="h-auto w-full"
          priority={active === 0}
        />
      </div>
    </section>
  );
}
