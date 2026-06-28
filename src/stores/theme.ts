import { create } from "zustand";
import type { ThemeInfo } from "../lib/ipc";
import { listThemes, readThemeCss } from "../lib/ipc";
import { injectThemeCss, clearThemeCss } from "../lib/themeInjector";
import { usePreferencesStore } from "./preferences";

export interface ThemeStore {
  activeThemeId: string | null;
  availableThemes: ThemeInfo[];
  loadThemes: () => Promise<void>;
  activateTheme: (directoryName: string) => Promise<void>;
  deactivateTheme: () => void;
  syncFromPreferences: () => Promise<void>;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  activeThemeId: null,
  availableThemes: [],

  loadThemes: async () => {
    try {
      const themes = await listThemes();
      set({ availableThemes: themes });
      await get().syncFromPreferences();
    } catch {
      // IPC unavailable (tests, plain browser dev)
    }
  },

  syncFromPreferences: async () => {
    const colorTheme = usePreferencesStore.getState().colorTheme;
    const themes = get().availableThemes;
    if (colorTheme && themes.some((t) => t.directory_name === colorTheme)) {
      await get().activateTheme(colorTheme);
    }
  },

  activateTheme: async (directoryName: string) => {
    try {
      const css = await readThemeCss(directoryName);
      injectThemeCss(css);
      set({ activeThemeId: directoryName });
    } catch (e) {
      console.error("[ThemeStore] Failed to activate theme:", e);
    }
  },

  deactivateTheme: () => {
    clearThemeCss();
    set({ activeThemeId: null });
  },
}));
