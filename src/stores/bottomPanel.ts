import { create } from "zustand";
import { useLlmResponseStore } from "./llmResponse";

export type TabId = "linked" | "unlinked" | "annotations" | "llm-response";

const DEFAULT_PANEL_HEIGHT = 200;
const MIN_PANEL_HEIGHT = 100;
const STORAGE_KEY = "lit-bottom-panel-height";

const DEFAULT_PANEL_WIDTH = 320;
const MIN_PANEL_WIDTH = 200;
const WIDTH_STORAGE_KEY = "lit-bottom-panel-width";

function loadPanelHeight(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return DEFAULT_PANEL_HEIGHT;
  const parsed = Number(stored);
  if (isNaN(parsed)) return DEFAULT_PANEL_HEIGHT;
  return Math.max(parsed, MIN_PANEL_HEIGHT);
}

function loadPanelWidth(): number {
  const stored = localStorage.getItem(WIDTH_STORAGE_KEY);
  if (stored === null) return DEFAULT_PANEL_WIDTH;
  const parsed = Number(stored);
  if (isNaN(parsed)) return DEFAULT_PANEL_WIDTH;
  return Math.max(parsed, MIN_PANEL_WIDTH);
}

export interface BottomPanelState {
  activeTab: TabId;
  unfolded: boolean;
  panelHeight: number;
  panelWidth: number;
  linkedCount: number | null;
  unlinkedCount: number | null;
  annotationCount: number;
  hasOpenedUnlinked: boolean;
  hasOpenedAnnotations: boolean;
  hasOpenedLlm: boolean;
  handleTabClick: (tab: TabId) => void;
  setUnfolded: (v: boolean) => void;
  setPanelHeight: (h: number) => void;
  setPanelWidth: (w: number) => void;
  setLinkedCount: (v: number | null) => void;
  setUnlinkedCount: (v: number | null) => void;
  setAnnotationCount: (v: number) => void;
  resetForPage: () => void;
}

export const useBottomPanelStore = create<BottomPanelState>((set, get) => ({
  activeTab: "linked",
  unfolded: false,
  panelHeight: loadPanelHeight(),
  panelWidth: loadPanelWidth(),
  linkedCount: null,
  unlinkedCount: null,
  annotationCount: 0,
  hasOpenedUnlinked: false,
  hasOpenedAnnotations: false,
  hasOpenedLlm: false,

  handleTabClick: (tab: TabId) => {
    const { unfolded, activeTab } = get();
    const updates: Partial<BottomPanelState> = {};
    if (tab === "unlinked") updates.hasOpenedUnlinked = true;
    if (tab === "annotations") updates.hasOpenedAnnotations = true;
    if (tab === "llm-response") updates.hasOpenedLlm = true;
    if (!unfolded) {
      updates.activeTab = tab;
      updates.unfolded = true;
    } else if (activeTab === tab) {
      updates.unfolded = false;
    } else {
      updates.activeTab = tab;
    }
    set(updates);
  },

  setUnfolded: (v: boolean) => {
    if (v) {
      const { activeTab } = get();
      const updates: Partial<BottomPanelState> = { unfolded: true };
      if (activeTab === "llm-response") updates.hasOpenedLlm = true;
      else if (activeTab === "unlinked") updates.hasOpenedUnlinked = true;
      else if (activeTab === "annotations") updates.hasOpenedAnnotations = true;
      set(updates);
    } else {
      set({ unfolded: false });
    }
  },

  setPanelHeight: (h: number) => {
    set({ panelHeight: h });
    localStorage.setItem(STORAGE_KEY, String(h));
  },

  setPanelWidth: (w: number) => {
    set({ panelWidth: w });
    localStorage.setItem(WIDTH_STORAGE_KEY, String(w));
  },

  setLinkedCount: (v: number | null) => set({ linkedCount: v }),
  setUnlinkedCount: (v: number | null) => set({ unlinkedCount: v }),
  setAnnotationCount: (v: number) => set({ annotationCount: v }),

  resetForPage: () => {
    const { activeTab, unfolded } = get();
    const llmActive = useLlmResponseStore.getState().status !== "idle";
    set({
      unfolded: false,
      linkedCount: null,
      unlinkedCount: null,
      annotationCount: 0,
      hasOpenedAnnotations: false,
      hasOpenedLlm: llmActive ? get().hasOpenedLlm : false,
      hasOpenedUnlinked: activeTab === "unlinked" && unfolded ? true : false,
    });
  },
}));

export { MIN_PANEL_HEIGHT, STORAGE_KEY, MIN_PANEL_WIDTH, WIDTH_STORAGE_KEY };
