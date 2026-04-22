import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { Preferences } from "../lib/ipc";
import { getPreferences } from "../lib/ipc";

export type FoldingShowControls = "mouseover" | "always" | "never";

export interface PreferencesState {
  darkMode: boolean;
  colorTheme: string | null;
  sidebarLocation: "left" | "right";
  foldingEnabled: boolean;
  foldingShowControls: FoldingShowControls;
  loaded: boolean;
  loadPreferences: () => Promise<void>;
}

function applySidebarLocation(val: string): "left" | "right" {
  return val === "right" ? "right" : "left";
}

function applyFoldingShowControls(val: string): FoldingShowControls {
  if (val === "always" || val === "never") return val;
  return "mouseover";
}

function mapPreferences(prefs: Preferences) {
  return {
    darkMode: prefs["workbench.darkMode"] ?? false,
    colorTheme: prefs["workbench.colorTheme"] ?? null,
    sidebarLocation: applySidebarLocation(prefs["workbench.sideBar.location"] ?? "left"),
    foldingEnabled: prefs["editor.folding.enabled"] ?? true,
    foldingShowControls: applyFoldingShowControls(prefs["editor.folding.showFoldingControls"] ?? "mouseover"),
  };
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  darkMode: false,
  colorTheme: null,
  sidebarLocation: "left",
  foldingEnabled: true,
  foldingShowControls: "mouseover",
  loaded: false,

  loadPreferences: async () => {
    try {
      const prefs = await getPreferences();
      set({ ...mapPreferences(prefs), loaded: true });
    } catch {
      set({ loaded: true });
    }

    try {
      await listen<Preferences>("preferences://changed", (event) => {
        set(mapPreferences(event.payload));
      });
    } catch {
      // event API unavailable
    }
  },
}));
