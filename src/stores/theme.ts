import { create } from "zustand";
import type { ThemeInfo } from "../lib/ipc";
import { listThemes, readThemeCss } from "../lib/ipc";
import { injectThemeCss, clearThemeCss } from "../lib/themeInjector";

const STORAGE_KEY = "lit-active-theme";

export interface ThemeStore {
  activeThemeId: string | null;
  availableThemes: ThemeInfo[];
  loadThemes: () => Promise<void>;
  activateTheme: (directoryName: string) => Promise<void>;
  deactivateTheme: () => void;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  activeThemeId: null,
  availableThemes: [],

  loadThemes: async () => {
    try {
      const themes = await listThemes();
      set({ availableThemes: themes });

      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && themes.some((t) => t.directory_name === stored)) {
        await get().activateTheme(stored);
      }
    } catch {
      // IPC unavailable (tests, plain browser dev)
    }
  },

  activateTheme: async (directoryName: string) => {
    try {
      const css = await readThemeCss(directoryName);
      injectThemeCss(css);
      set({ activeThemeId: directoryName });
      localStorage.setItem(STORAGE_KEY, directoryName);
    } catch (e) {
      console.error("[ThemeStore] Failed to activate theme:", e);
    }
  },

  deactivateTheme: () => {
    clearThemeCss();
    set({ activeThemeId: null });
    localStorage.removeItem(STORAGE_KEY);
  },
}));
