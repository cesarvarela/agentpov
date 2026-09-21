import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@agentview/ui";

const isMac = window.agentview?.platform === "darwin";

export default function App() {
  const [appName, setAppName] = useState("agentview");
  const [folder, setFolder] = useState<string | null>(null);

  useEffect(() => {
    window.agentview?.getAppName().then(setAppName).catch(() => {});
  }, []);

  async function handleOpenFolder() {
    try {
      const selected = await window.agentview?.openFolder();
      if (selected) setFolder(selected);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="bg-background text-foreground flex h-full flex-col">
      <header
        className="border-border bg-card flex h-11 shrink-0 items-center justify-center border-b"
        style={
          {
            WebkitAppRegion: "drag",
            paddingLeft: isMac ? 78 : undefined,
          } as CSSProperties
        }
      >
        <span className="text-muted-foreground font-mono text-xs">
          {appName}
        </span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          <span className="text-om-amber">{appName}</span>
        </h1>
        <p className="text-muted-foreground max-w-md text-sm">
          See which CLAUDE.md files, settings, permission rules, hooks, skills,
          agents and MCP servers affect a file.
        </p>

        <Button onClick={handleOpenFolder}>Open folder</Button>

        {folder ? (
          <p className="text-muted-foreground font-mono text-xs">{folder}</p>
        ) : null}

        <p className="text-muted-foreground font-mono text-[11px]">
          electron {window.agentview?.versions.electron ?? "—"} · chrome{" "}
          {window.agentview?.versions.chrome ?? "—"} · node{" "}
          {window.agentview?.versions.node ?? "—"}
        </p>
      </main>
    </div>
  );
}
