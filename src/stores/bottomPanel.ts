import { create } from "zustand";
import { useLlmResponseStore } from "./llmResponse";

export type TabId = "linked" | "unlinked" | "outgoing" | "annotations" | "llm-response";

export type TabMeta = { count: number | null; hasOpened: boolean };
export type TabMetaMap = Record<TabId, TabMeta>;

export function defaultTabMeta(): TabMetaMap {
  return {
    linked: { count: null, hasOpened: true },
    unlinked: { count: null, hasOpened: false },
    outgoing: { count: null, hasOpened: false },
    annotations: { count: 0, hasOpened: false },
    "llm-response": { count: null, hasOpened: false },
  };
}

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
  tabMeta: TabMetaMap;
  handleTabClick: (tab: TabId) => void;
  setUnfolded: (v: boolean) => void;
  setPanelHeight: (h: number) => void;
  setPanelWidth: (w: number) => void;
  setTabCount: (tab: TabId, count: number | null) => void;
  markOpened: (tab: TabId) => void;
  resetForPage: () => void;
}

export const useBottomPanelStore = create<BottomPanelState>((set, get) => ({
  activeTab: "linked",
  unfolded: false,
  panelHeight: loadPanelHeight(),
  panelWidth: loadPanelWidth(),
  tabMeta: defaultTabMeta(),

  handleTabClick: (tab: TabId) => {
    const { unfolded, activeTab, tabMeta: prev } = get();
    const tabMeta = { ...prev, [tab]: { ...prev[tab], hasOpened: true } };
    if (!unfolded) {
      set({ activeTab: tab, unfolded: true, tabMeta });
    } else if (activeTab === tab) {
      set({ unfolded: false, tabMeta });
    } else {
      set({ activeTab: tab, tabMeta });
    }
  },

  setUnfolded: (v: boolean) => {
    if (v) {
      const { activeTab, tabMeta: prev } = get();
      const tabMeta = { ...prev, [activeTab]: { ...prev[activeTab], hasOpened: true } };
      set({ unfolded: true, tabMeta });
    } else {
      set({ unfolded: false });
    }
  },

  setPanelHeight: (h: number) => {
    const clamped = Math.max(h, MIN_PANEL_HEIGHT);
    set({ panelHeight: clamped });
    localStorage.setItem(STORAGE_KEY, String(clamped));
  },

  setPanelWidth: (w: number) => {
    const clamped = Math.max(w, MIN_PANEL_WIDTH);
    set({ panelWidth: clamped });
    localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
  },

  setTabCount: (tab: TabId, count: number | null) =>
    set((s) => ({ tabMeta: { ...s.tabMeta, [tab]: { ...s.tabMeta[tab], count } } })),

  markOpened: (tab: TabId) =>
    set((s) => ({ tabMeta: { ...s.tabMeta, [tab]: { ...s.tabMeta[tab], hasOpened: true } } })),

  resetForPage: () => {
    const { activeTab, unfolded, tabMeta: prev } = get();
    const llmActive = useLlmResponseStore.getState().status !== "idle";

    const tabMeta: TabMetaMap = {
      linked: { count: null, hasOpened: true },
      unlinked: {
        count: null,
        hasOpened: activeTab === "unlinked" && unfolded,
      },
      outgoing: {
        count: null,
        hasOpened: activeTab === "outgoing" && unfolded,
      },
      annotations: { count: 0, hasOpened: false },
      "llm-response": {
        count: prev["llm-response"].count,
        hasOpened: llmActive ? prev["llm-response"].hasOpened : false,
      },
    };

    set({ unfolded: false, tabMeta });
  },
}));

export {
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_PANEL_WIDTH,
  MIN_PANEL_HEIGHT,
  STORAGE_KEY,
  MIN_PANEL_WIDTH,
  WIDTH_STORAGE_KEY,
};
