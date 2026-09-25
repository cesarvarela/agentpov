import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agentpov/ui";

import { Workflow } from "./workflow";

const REPO_URL = "https://github.com/cesarvarela/agentpov";
// Stable asset name (see apps/desktop/electron-builder.yml), so this always
// resolves to the newest release.
const DOWNLOAD_URL = `${REPO_URL}/releases/latest/download/agentpov-mac.dmg`;

const features = [
  {
    title: "Instructions",
    body: "Every CLAUDE.md and memory file that reaches this path — managed, user, project, local, directory — in the order they apply.",
    tone: "text-om-amber",
  },
  {
    title: "Permissions",
    body: "Which allow / ask / deny rule actually decides a tool call, and which rules are shadowed by a higher layer.",
    tone: "text-om-teal",
  },
  {
    title: "Hooks & tools",
    body: "Hooks by event and level, plus the skills, subagents and MCP servers available in this folder — and the ones that never fire.",
    tone: "text-om-allow",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-14 px-6 py-20">
      <section className="flex flex-col items-start gap-6">
        <span className="border-border bg-card text-muted-foreground rounded-md border px-2.5 py-1 font-mono text-xs">
          Claude Code first
        </span>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          See your folder the way your{" "}
          <span className="text-om-amber">coding agent</span> does.
        </h1>
        <p className="text-muted-foreground max-w-2xl text-lg">
          agentpov is a desktop app that resolves, for any file you select,
          exactly which instructions, settings, permission rules, hooks, skills,
          agents and MCP servers are in effect — and where each one came from.
        </p>
        <div className="flex flex-col items-start gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" asChild>
              <a href={DOWNLOAD_URL}>Download for macOS</a>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                View on GitHub
              </a>
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            macOS 13+ · Apple Silicon &amp; Intel
          </p>
        </div>
        <p className="text-muted-foreground font-mono text-xs">
          ~/projects/acme/shop-api → src/api/payments.ts
        </p>
      </section>

      <Workflow />

      <section className="grid gap-4 sm:grid-cols-3">
        {features.map((feature) => (
          <Card key={feature.title}>
            <CardHeader>
              <CardTitle className={feature.tone}>{feature.title}</CardTitle>
              <CardDescription>Resolved per file</CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              {feature.body}
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
