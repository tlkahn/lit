import { create } from "zustand";
import { useLlmResponseStore } from "./llmResponse";

export type TabId = "linked" | "unlinked" | "annotations" | "llm-response";

const DEFAULT_PANEL_HEIGHT = 200;
const MIN_PANEL_HEIGHT = 100;
const STORAGE_KEY = "lit-bottom-panel-height";

function loadPanelHeight(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return DEFAULT_PANEL_HEIGHT;
  const parsed = Number(stored);
  if (isNaN(parsed)) return DEFAULT_PANEL_HEIGHT;
  return Math.max(parsed, MIN_PANEL_HEIGHT);
}

export interface BottomPanelState {
  activeTab: TabId;
  unfolded: boolean;
  panelHeight: number;
  linkedCount: number | null;
  unlinkedCount: number | null;
  annotationCount: number;
  hasOpenedUnlinked: boolean;
  hasOpenedAnnotations: boolean;
  hasOpenedLlm: boolean;
  handleTabClick: (tab: TabId) => void;
  setUnfolded: (v: boolean) => void;
  setPanelHeight: (h: number) => void;
  setLinkedCount: (v: number | null) => void;
  setUnlinkedCount: (v: number | null) => void;
  setAnnotationCount: (v: number) => void;
  resetForPage: () => void;
}

export const useBottomPanelStore = create<BottomPanelState>((set, get) => ({
  activeTab: "linked",
  unfolded: false,
  panelHeight: loadPanelHeight(),
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

  setUnfolded: (v: boolean) => set({ unfolded: v }),

  setPanelHeight: (h: number) => {
    set({ panelHeight: h });
    localStorage.setItem(STORAGE_KEY, String(h));
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

export { MIN_PANEL_HEIGHT, STORAGE_KEY };
