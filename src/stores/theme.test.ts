import { describe, it, expect, beforeEach } from "vitest";
import { useThemeStore } from "./theme";
import { usePreferencesStore } from "./preferences";
import { mockInvoke } from "../test/tauri-mock";

const themes = [
  { name: "Book", directory_name: "book", version: "1.0", author: "test" },
  { name: "Nordic", directory_name: "nordic", version: "1.0", author: "test" },
];

let invokeCalls: { cmd: string; args: Record<string, unknown> }[];

function mockThemeIpc(opts: { setPreferenceRejects?: boolean } = {}) {
  mockInvoke((cmd, args) => {
    invokeCalls.push({ cmd, args: args ?? {} });
    switch (cmd) {
      case "list_themes":
        return themes;
      case "read_theme_css":
        return "body { color: red; }";
      case "set_preference":
        if (opts.setPreferenceRejects) throw new Error("disk full");
        return undefined;
      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  });
}

describe("ThemeStore", () => {
  beforeEach(() => {
    invokeCalls = [];
    useThemeStore.setState({ activeThemeId: null, availableThemes: [], themesLoaded: false });
    usePreferencesStore.setState({ colorTheme: null });
    mockThemeIpc();
  });

  describe("loadThemes", () => {
    it("loads the theme list, marks themesLoaded, and syncs", async () => {
      usePreferencesStore.setState({ colorTheme: "book" });
      await useThemeStore.getState().loadThemes();
      const state = useThemeStore.getState();
      expect(state.availableThemes).toEqual(themes);
      expect(state.themesLoaded).toBe(true);
      expect(state.activeThemeId).toBe("book");
    });

    it("leaves themesLoaded false when listing fails", async () => {
      mockInvoke(() => {
        throw new Error("IPC unavailable");
      });
      await useThemeStore.getState().loadThemes();
      expect(useThemeStore.getState().themesLoaded).toBe(false);
    });
  });

  describe("syncFromPreferences", () => {
    it("activates a saved theme that exists in the list", async () => {
      useThemeStore.setState({ availableThemes: themes, themesLoaded: true });
      usePreferencesStore.setState({ colorTheme: "nordic" });
      await useThemeStore.getState().syncFromPreferences();
      expect(useThemeStore.getState().activeThemeId).toBe("nordic");
      expect(usePreferencesStore.getState().colorTheme).toBe("nordic");
    });

    it("is a no-op on preferences when colorTheme is null", async () => {
      useThemeStore.setState({ availableThemes: themes, themesLoaded: true });
      await useThemeStore.getState().syncFromPreferences();
      expect(useThemeStore.getState().activeThemeId).toBeNull();
      expect(invokeCalls.filter((c) => c.cmd === "set_preference")).toHaveLength(0);
    });

    it("only deactivates, never clears the pref, before themes have loaded (launch race)", async () => {
      // Simulates loadPreferences() resolving before initThemes(): the theme
      // list is still empty, so a valid saved theme must not be clobbered.
      usePreferencesStore.setState({ colorTheme: "book" });
      await useThemeStore.getState().syncFromPreferences();
      expect(useThemeStore.getState().activeThemeId).toBeNull();
      expect(usePreferencesStore.getState().colorTheme).toBe("book");
      expect(invokeCalls.filter((c) => c.cmd === "set_preference")).toHaveLength(0);
    });

    it("clears and persists a stale colorTheme once themes are loaded", async () => {
      useThemeStore.setState({ availableThemes: themes, themesLoaded: true });
      usePreferencesStore.setState({ colorTheme: "uninstalled-theme" });
      await useThemeStore.getState().syncFromPreferences();
      expect(usePreferencesStore.getState().colorTheme).toBeNull();
      expect(invokeCalls.filter((c) => c.cmd === "set_preference")).toEqual([
        { cmd: "set_preference", args: { key: "workbench.colorTheme", value: null } },
      ]);
    });

    it("stays null and does not loop when persisting the cleared pref rejects (livelock regression)", async () => {
      // The #890/#891 vitest livelock: clearing a stale theme while
      // set_preference rejects must not revert-and-retry forever.
      mockThemeIpc({ setPreferenceRejects: true });
      useThemeStore.setState({ availableThemes: themes, themesLoaded: true });
      usePreferencesStore.setState({ colorTheme: "uninstalled-theme" });
      await useThemeStore.getState().syncFromPreferences();
      // Drain pending microtasks so any feedback loop would have surfaced.
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(usePreferencesStore.getState().colorTheme).toBeNull();
      expect(invokeCalls.filter((c) => c.cmd === "set_preference")).toHaveLength(1);
    });
  });
});
