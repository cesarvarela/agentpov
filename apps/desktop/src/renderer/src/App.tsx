import { useCallback, useEffect, useState } from "react";
import { Allotment, LayoutPriority } from "allotment";
import { Button } from "@agentview/ui";

import { ContextView } from "./components/ContextView";
import { FileTree } from "./components/FileTree";
import { RecentRow } from "./components/ProjectSwitcher";
import { RemoteDialog } from "./components/RemoteDialog";
import { SourcePane, SourcePaneEmpty } from "./components/SourcePane";
import { SshPromptDialog } from "./components/SshPromptDialog";
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
  const { homeDir } = project;
  const [remoteOpen, setRemoteOpen] = useState(false);
  const closeRemote = useCallback(() => setRemoteOpen(false), []);
  const sidebar = useSidebar();
  const {
    source,
    open: sourceOpen,
    openSource,
    closeSource,
    reset: resetSource,
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

  const { folder, openFolder } = project;

  /** Cmd/Ctrl+O opens a local folder, with Shift a folder over SSH. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!(isMac ? event.metaKey : event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "o") return;
      event.preventDefault();
      if (event.shiftKey) setRemoteOpen(true);
      else void openFolder();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openFolder]);

  /**
   * Another project drops the source pane and its history: those paths belong
   * to the previous folder, possibly on another machine.
   */
  useEffect(() => {
    resetSource();
  }, [folder, project.host, resetSource]);

  /** Opening a folder always reveals the tree, even if it was collapsed before. */
  useEffect(() => {
    if (folder) setCollapsed(false);
  }, [folder, setCollapsed]);

  return (
    <div className="bg-background text-foreground flex h-full flex-col">
      <TopBar
        appName={appName}
        folder={folder}
        host={project.host}
        folderLabel={folder ? displayPath(folder, null, homeDir) : ""}
        recents={project.recents}
        opening={project.opening}
        isMac={isMac}
        sidebarCollapsed={sidebar.collapsed}
        sourceOpen={sourceOpen}
        onOpenFolder={() => void project.openFolder()}
        onOpenRemote={() => setRemoteOpen(true)}
        onOpenRecent={(entry) => void project.openRecent(entry)}
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
                  selected={project.target?.path ?? null}
                  expanded={project.expanded}
                  onSelect={project.select}
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
                  {!project.context && project.loading ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
                      <p className="text-om-text animate-pulse text-sm">
                        {project.host
                          ? `Reading agent context from ${project.host}…`
                          : "Reading agent context…"}
                      </p>
                      <p className="text-om-muted max-w-sm text-xs">
                        Instructions, memory, settings, hooks, skills and MCP servers.
                      </p>
                    </div>
                  ) : (
                    <ContextView
                      context={project.context}
                      detail={project.detail}
                      folder={folder}
                      target={project.target}
                      homeDir={homeDir}
                      loading={project.loading}
                      activeSourceKey={source?.key ?? null}
                      onOpenSource={openSource}
                    />
                  )}
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
                    remote={project.host !== null}
                    source={source}
                    folder={folder}
                    homeDir={homeDir}
                    onOpenPath={(path, line) =>
                      openSource({
                        key: `path:${path}`,
                        path,
                        ...(line === undefined ? {} : { line }),
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

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void project.openFolder()}>
              Open folder…
            </Button>
            <Button variant="outline" onClick={() => setRemoteOpen(true)}>
              Open over SSH…
            </Button>
          </div>

          {project.opening ? (
            <p className="text-om-muted animate-pulse text-xs">Opening…</p>
          ) : project.error ? (
            <p className="text-om-deny max-w-md font-mono text-[11px]">{project.error}</p>
          ) : null}

          {project.recents.length > 0 ? (
            <div className="flex w-[360px] max-w-full flex-col text-left">
              <div className="text-om-muted px-2 pb-1 text-[11px]">Recent</div>
              {project.recents.slice(0, 6).map((entry) => (
                <button
                  key={`${entry.host ?? ""}\t${entry.path}`}
                  type="button"
                  disabled={project.opening}
                  onClick={() => void project.openRecent(entry)}
                  className="hover:bg-om-raised flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors disabled:cursor-default disabled:opacity-60"
                >
                  <RecentRow entry={entry} />
                </button>
              ))}
            </div>
          ) : null}

          <p className="text-muted-foreground font-mono text-[11px]">
            electron {window.agentview?.versions.electron ?? "—"} · chrome{" "}
            {window.agentview?.versions.chrome ?? "—"} · node{" "}
            {window.agentview?.versions.node ?? "—"}
          </p>
        </main>
      )}

      {remoteOpen ? (
        <RemoteDialog
          recents={project.recents}
          onOpen={project.openRemote}
          onClose={closeRemote}
        />
      ) : null}
      <SshPromptDialog />
    </div>
  );
}
