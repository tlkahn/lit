import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { Preferences } from "../lib/ipc";
import { getPreferences } from "../lib/ipc";

export interface PreferencesState {
  darkMode: boolean;
  colorTheme: string | null;
  sidebarLocation: "left" | "right";
  loaded: boolean;
  loadPreferences: () => Promise<void>;
}

function applySidebarLocation(val: string): "left" | "right" {
  return val === "right" ? "right" : "left";
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  darkMode: false,
  colorTheme: null,
  sidebarLocation: "left",
  loaded: false,

  loadPreferences: async () => {
    try {
      const prefs = await getPreferences();
      set({
        darkMode: prefs["workbench.darkMode"] ?? false,
        colorTheme: prefs["workbench.colorTheme"] ?? null,
        sidebarLocation: applySidebarLocation(prefs["workbench.sideBar.location"] ?? "left"),
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }

    try {
      await listen<Preferences>("preferences://changed", (event) => {
        const prefs = event.payload;
        set({
          darkMode: prefs["workbench.darkMode"] ?? false,
          colorTheme: prefs["workbench.colorTheme"] ?? null,
          sidebarLocation: applySidebarLocation(prefs["workbench.sideBar.location"] ?? "left"),
        });
      });
    } catch {
      // event API unavailable
    }
  },
}));
