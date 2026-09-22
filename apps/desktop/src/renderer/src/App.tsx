import { useCallback, useEffect, useState } from "react";
import { Allotment, LayoutPriority } from "allotment";
import { Button } from "@agentview/ui";

import { ContextView } from "./components/ContextView";
import { FileTree } from "./components/FileTree";
import { SourcePane, SourcePaneEmpty } from "./components/SourcePane";
import { TopBar } from "./components/TopBar";
import { useProject } from "./hooks/useProject";
import { usePanePersistence } from "./hooks/usePanePersistence";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebar,
} from "./hooks/useSidebar";
import { useSource } from "./hooks/useSource";
import { displayPath } from "./lib/paths";

const isMac = window.agentview?.platform === "darwin";
const homeDir = window.agentview?.homeDir ?? "";

const SOURCE_DEFAULT_WIDTH = 480;
const SOURCE_MIN_WIDTH = 320;
const SOURCE_MAX_WIDTH = 900;

/** True while the user is typing somewhere, so Escape belongs to that field. */
function typingInField(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (active.isContentEditable) return true;
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export default function App() {
  const [appName, setAppName] = useState("agentview");
  const project = useProject();
  const sidebar = useSidebar();
  const {
    source,
    open: sourceOpen,
    openSource,
    closeSource,
    toggle: toggleSource,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
  } = useSource();
  const sourcePane = usePanePersistence("source", {
    defaultWidth: SOURCE_DEFAULT_WIDTH,
    minWidth: SOURCE_MIN_WIDTH,
    maxWidth: SOURCE_MAX_WIDTH,
  });

  useEffect(() => {
    window.agentview
      ?.getAppName()
      .then(setAppName)
      .catch(() => {});
  }, []);

  const { collapsed, recordWidth, setCollapsed } = sidebar;
  const recordSourceWidth = sourcePane.recordWidth;

  const handleSizesChange = useCallback(
    (sizes: number[]) => {
      const width = sizes[0];
      if (!collapsed && width !== undefined) recordWidth(width);
      const sourceWidth = sizes[2];
      if (sourceOpen && sourceWidth !== undefined) {
        recordSourceWidth(sourceWidth);
      }
    },
    [collapsed, recordWidth, recordSourceWidth, sourceOpen],
  );

  /** Fired when a drag past the minimum snaps a side pane shut. */
  const handleVisibleChange = useCallback(
    (index: number, visible: boolean) => {
      if (index === 0) setCollapsed(!visible);
      else if (index === 2 && !visible) closeSource();
    },
    [closeSource, setCollapsed],
  );

  /** Escape closes the source pane, unless the user is typing in a field. */
  useEffect(() => {
    if (!sourceOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (typingInField()) return;
      closeSource();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSource, sourceOpen]);

  /** Cmd/Ctrl+[ and Cmd/Ctrl+] walk the source pane's history. */
  useEffect(() => {
    if (!sourceOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!(isMac ? event.metaKey : event.ctrlKey)) return;
      if (event.key !== "[" && event.key !== "]") return;
      if (typingInField()) return;
      event.preventDefault();
      if (event.key === "[") goBack();
      else goForward();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goBack, goForward, sourceOpen]);

  const { folder } = project;

  /** Opening a folder always reveals the tree, even if it was collapsed before. */
  useEffect(() => {
    if (folder) setCollapsed(false);
  }, [folder, setCollapsed]);

  return (
    <div className="bg-background text-foreground flex h-full flex-col">
      <TopBar
        appName={appName}
        folder={folder}
        folderLabel={folder ? displayPath(folder, null, homeDir) : ""}
        isMac={isMac}
        sidebarCollapsed={sidebar.collapsed}
        sourceOpen={sourceOpen}
        onOpenFolder={() => void project.openFolder()}
        onToggleSidebar={sidebar.toggle}
        onToggleSource={toggleSource}
      />

      {folder ? (
        <div className="flex min-h-0 flex-1">

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
                    activeSourceKey={source?.key ?? null}
                    onOpenSource={openSource}
                  />
                </main>
              </Allotment.Pane>

              <Allotment.Pane
                preferredSize={sourcePane.initialWidth}
                minSize={SOURCE_MIN_WIDTH}
                maxSize={SOURCE_MAX_WIDTH}
                snap
                visible={sourceOpen}
              >
                {source ? (
                  <SourcePane
                    source={source}
                    folder={folder}
                    homeDir={homeDir}
                    onOpenParent={(path, line) =>
                      openSource({
                        key: `parent:${path}:${line}`,
                        path,
                        line,
                      })
                    }
                    canGoBack={canGoBack}
                    canGoForward={canGoForward}
                    onBack={goBack}
                    onForward={goForward}
                  />
                ) : (
                  <SourcePaneEmpty />
                )}
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
