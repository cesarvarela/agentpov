import { useCallback, useEffect, useState } from "react";
import { Allotment, LayoutPriority } from "allotment";
import { Button } from "@agentview/ui";

import { ContextView } from "./components/ContextView";
import { FileTree } from "./components/FileTree";
import { SidebarStrip } from "./components/SidebarStrip";
import { TopBar } from "./components/TopBar";
import { useProject } from "./hooks/useProject";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebar,
} from "./hooks/useSidebar";
import { basename, displayPath } from "./lib/paths";

const isMac = window.agentview?.platform === "darwin";
const homeDir = window.agentview?.homeDir ?? "";

export default function App() {
  const [appName, setAppName] = useState("agentview");
  const project = useProject();
  const sidebar = useSidebar();

  useEffect(() => {
    window.agentview
      ?.getAppName()
      .then(setAppName)
      .catch(() => {});
  }, []);

  const { collapsed, recordWidth, setCollapsed } = sidebar;

  const handleSizesChange = useCallback(
    (sizes: number[]) => {
      const width = sizes[0];
      if (!collapsed && width !== undefined) recordWidth(width);
    },
    [collapsed, recordWidth],
  );

  /** Fired when a drag past the minimum snaps the sidebar shut. */
  const handleVisibleChange = useCallback(
    (index: number, visible: boolean) => {
      if (index === 0) setCollapsed(!visible);
    },
    [setCollapsed],
  );

  const { folder } = project;

  return (
    <div className="bg-background text-foreground flex h-full flex-col">
      <TopBar
        appName={appName}
        folder={folder}
        folderLabel={folder ? displayPath(folder, null, homeDir) : ""}
        isMac={isMac}
        sidebarCollapsed={sidebar.collapsed}
        onOpenFolder={() => void project.openFolder()}
        onToggleSidebar={sidebar.toggle}
      />

      {folder ? (
        <div className="flex min-h-0 flex-1">
          {sidebar.collapsed ? (
            <SidebarStrip
              label={basename(folder)}
              onExpand={() => setCollapsed(false)}
            />
          ) : null}

          <div className="min-w-0 flex-1">
            <Allotment
              proportionalLayout={false}
              onChange={handleSizesChange}
              onVisibleChange={handleVisibleChange}
            >
              <Allotment.Pane
                preferredSize={sidebar.initialWidth}
                minSize={SIDEBAR_MIN_WIDTH}
                maxSize={SIDEBAR_MAX_WIDTH}
                snap
                visible={!sidebar.collapsed}
              >
                <FileTree
                  folder={folder}
                  tree={project.tree}
                  selected={project.selected}
                  expanded={project.expanded}
                  onSelectFile={project.selectFile}
                  onToggleDir={project.toggleDir}
                />
              </Allotment.Pane>

              <Allotment.Pane priority={LayoutPriority.High}>
                <main className="flex h-full min-w-0 flex-col overflow-hidden">
                  {project.error ? (
                    <div className="text-om-deny border-om-border border-b px-5 py-2 text-[11px]">
                      {project.error}
                    </div>
                  ) : null}
                  <ContextView
                    context={project.context}
                    detail={project.detail}
                    folder={folder}
                    file={project.selected}
                    homeDir={homeDir}
                    loading={project.loading}
                  />
                </main>
              </Allotment.Pane>
            </Allotment>
          </div>
        </div>
      ) : (
        <main className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            <span className="text-om-amber">{appName}</span>
          </h1>
          <p className="text-muted-foreground max-w-md text-sm">
            See which CLAUDE.md files, settings, permission rules, hooks, skills,
            agents and MCP servers affect a file.
          </p>

          <Button onClick={() => void project.openFolder()}>Open folder</Button>

          <p className="text-muted-foreground font-mono text-[11px]">
            electron {window.agentview?.versions.electron ?? "—"} · chrome{" "}
            {window.agentview?.versions.chrome ?? "—"} · node{" "}
            {window.agentview?.versions.node ?? "—"}
          </p>
        </main>
      )}
    </div>
  );
}
