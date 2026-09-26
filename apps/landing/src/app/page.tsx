import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agentpov/ui";

import { Workflow } from "./workflow";
import { WorksWith } from "./works-with";

const REPO_URL = "https://github.com/cesarvarela/agentpov";
// Stable asset name (see apps/desktop/electron-builder.yml), so this always
// resolves to the newest release.
const DOWNLOAD_URL = `${REPO_URL}/releases/latest/download/agentpov-mac.dmg`;

const features = [
  {
    title: "Instructions",
    subtitle: "What the agent is told",
    body: "Every instruction and memory file that reaches this path, from org-wide policy down to the folder itself, in the order the agent reads them.",
    tone: "text-om-amber",
  },
  {
    title: "Permissions",
    subtitle: "What it may do",
    body: "Which allow, ask or deny rule decides each tool call on this path, and which rules a higher layer overrides.",
    tone: "text-om-teal",
  },
  {
    title: "Hooks & tools",
    subtitle: "What runs alongside it",
    body: "The hooks that fire when the agent edits here, plus the skills, subagents and MCP servers it can reach, grouped by where each is defined.",
    tone: "text-om-allow",
  },
];

const footerLinks = [
  { label: "Download", href: DOWNLOAD_URL },
  { label: "Releases", href: `${REPO_URL}/releases` },
  { label: "GitHub", href: REPO_URL },
  { label: "Report an issue", href: `${REPO_URL}/issues` },
];

export default function Home() {
  return (
    <>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-14 px-6 py-20">
        <section className="flex flex-col items-start gap-6">
          <WorksWith />
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            See your project from your{" "}
            <span className="text-om-amber">agent&rsquo;s point of view</span>.
          </h1>
          <p className="text-muted-foreground max-w-2xl text-lg">
            Pick any file or folder and agentpov shows what your coding agent
            works with there: the instructions and memory it reads, the
            permission rules and hooks that apply, the skills, subagents and MCP
            servers it can reach, and where each one came from.
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
        </section>

        <Workflow />

        <section className="grid gap-4 sm:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title}>
              <CardHeader>
                <CardTitle className={feature.tone}>{feature.title}</CardTitle>
                <CardDescription>{feature.subtitle}</CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm">
                {feature.body}
              </CardContent>
            </Card>
          ))}
        </section>
      </main>

      <footer className="border-border border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-om-amber font-semibold">agentpov</span>
            <span className="text-muted-foreground text-sm">
              Your project, from your agent&rsquo;s point of view.
            </span>
            <span className="text-muted-foreground text-xs">
              MIT licensed · Made with ❤️ by{" "}
              <a
                href="https://github.com/cesarvarela"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground underline underline-offset-2"
              >
                Cesar Varela
              </a>
            </span>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {footerLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                {...(link.href === DOWNLOAD_URL
                  ? {}
                  : { target: "_blank", rel: "noopener noreferrer" })}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      </footer>
    </>
  );
}
