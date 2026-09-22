import { usePanePersistence, type PaneState } from "./usePanePersistence";

export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 520;

export type SidebarState = PaneState;

/** Sidebar width / collapsed state, persisted in localStorage. */
export function useSidebar(): SidebarState {
  return usePanePersistence("sidebar", {
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    maxWidth: SIDEBAR_MAX_WIDTH,
  });
}
