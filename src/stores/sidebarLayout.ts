import { create } from "zustand";

export const DEFAULT_SIDEBAR_WIDTH_PX = 240;
export const MIN_SIDEBAR_WIDTH_PX = 180;
export const SIDEBAR_WIDTH_STORAGE_KEY = "lit-sidebar-width";
// Matches ResizeHandle's horizontal maxRatio (0.5). Duplicated here so the
// window-resize clamp helper does not magic-number it.
export const SIDEBAR_MAX_WIDTH_RATIO = 0.5;
// Backward-compat alias used by existing imports/tests during migration.
export const SIDEBAR_WIDTH_PX = DEFAULT_SIDEBAR_WIDTH_PX;

export function parseStoredSidebarWidth(raw: string | null): number {
  if (raw === null) return DEFAULT_SIDEBAR_WIDTH_PX;
  const parsed = Number(raw);
  if (isNaN(parsed)) return DEFAULT_SIDEBAR_WIDTH_PX;
  return Math.max(parsed, MIN_SIDEBAR_WIDTH_PX);
}

function loadSidebarWidth(): number {
  return parseStoredSidebarWidth(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
}

export interface SidebarLayoutState {
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
}

export const useSidebarLayoutStore = create<SidebarLayoutState>((set) => ({
  sidebarWidth: loadSidebarWidth(),
  setSidebarWidth: (w: number) => {
    const clamped = Math.max(w, MIN_SIDEBAR_WIDTH_PX);
    set({ sidebarWidth: clamped });
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped));
  },
}));
