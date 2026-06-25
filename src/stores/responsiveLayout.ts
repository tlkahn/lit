import { create } from "zustand";

export const SIDEBAR_COLLAPSE_PX = 900;
export const PANE_COLLAPSE_PX = 700;
export const PANEL_FORCE_BOTTOM_PX = 600;
export const HYSTERESIS_PX = 20;

interface ResponsiveLayoutState {
  windowWidth: number;
  sidebarAutoCollapsed: boolean;
  panesCollapsed: boolean;
  bottomPanelForceBottom: boolean;
  setWindowWidth: (width: number) => void;
}

export const useResponsiveLayoutStore = create<ResponsiveLayoutState>((set, get) => ({
  windowWidth: typeof window !== "undefined" ? window.innerWidth : 1024,
  sidebarAutoCollapsed: false,
  panesCollapsed: false,
  bottomPanelForceBottom: false,

  setWindowWidth: (width) => {
    const prev = get();

    const sidebarAutoCollapsed = prev.sidebarAutoCollapsed
      ? width < SIDEBAR_COLLAPSE_PX + HYSTERESIS_PX
      : width < SIDEBAR_COLLAPSE_PX;

    const panesCollapsed = prev.panesCollapsed
      ? width < PANE_COLLAPSE_PX + HYSTERESIS_PX
      : width < PANE_COLLAPSE_PX;

    const bottomPanelForceBottom = prev.bottomPanelForceBottom
      ? width < PANEL_FORCE_BOTTOM_PX + HYSTERESIS_PX
      : width < PANEL_FORCE_BOTTOM_PX;

    set({ windowWidth: width, sidebarAutoCollapsed, panesCollapsed, bottomPanelForceBottom });
  },
}));
