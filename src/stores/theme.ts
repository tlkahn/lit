import { create } from "zustand";
import type { ThemeInfo } from "../lib/ipc";
import { listThemes, readThemeCss, setPreference } from "../lib/ipc";
import { injectThemeCss, clearThemeCss } from "../lib/themeInjector";
import { usePreferencesStore } from "./preferences";

export interface ThemeStore {
  activeThemeId: string | null;
  availableThemes: ThemeInfo[];
  themesLoaded: boolean;
  loadThemes: () => Promise<void>;
  activateTheme: (directoryName: string) => Promise<void>;
  deactivateTheme: () => void;
  syncFromPreferences: () => Promise<void>;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  activeThemeId: null,
  availableThemes: [],
  themesLoaded: false,

  loadThemes: async () => {
    try {
      const themes = await listThemes();
      set({ availableThemes: themes, themesLoaded: true });
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
    } else {
      get().deactivateTheme();
      // Clear a stale colorTheme (theme was uninstalled) - but only once the
      // theme list has actually loaded; before that an empty list just means
      // "not loaded yet" and clearing would clobber a valid saved theme.
      // Fire-and-forget persistence with no revert: in-memory null is correct
      // for this session either way, and a persist failure only means the
      // stale value is retried next launch. Reverting on failure would
      // re-trigger this cleanup and loop.
      if (colorTheme != null && get().themesLoaded) {
        usePreferencesStore.setState({ colorTheme: null });
        setPreference("workbench.colorTheme", null).catch(() => {});
      }
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
