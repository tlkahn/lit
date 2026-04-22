import { describe, it, expect, beforeEach } from "vitest";
import { usePreferencesStore } from "./preferences";
import { mockInvoke, mockListen, emitMockEvent } from "../test/tauri-mock";

describe("PreferencesStore", () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      darkMode: "auto",
      colorTheme: null,
      sidebarLocation: "left",
      loaded: false,
    });
  });

  it("loads preferences via IPC on mount", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": "lit-nordic",
          "workbench.darkMode": "dark",
          "workbench.sideBar.location": "right",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();

    const state = usePreferencesStore.getState();
    expect(state.darkMode).toBe("dark");
    expect(state.colorTheme).toBe("lit-nordic");
    expect(state.sidebarLocation).toBe("right");
    expect(state.loaded).toBe(true);
  });

  it("uses defaults when IPC returns minimal prefs", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "light",
          "workbench.sideBar.location": "left",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();

    const state = usePreferencesStore.getState();
    expect(state.darkMode).toBe("light");
    expect(state.colorTheme).toBeNull();
    expect(state.sidebarLocation).toBe("left");
  });

  it("maps legacy boolean true to 'dark'", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": true,
          "workbench.sideBar.location": "left",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().darkMode).toBe("dark");
  });

  it("maps legacy boolean false to 'light'", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": false,
          "workbench.sideBar.location": "left",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().darkMode).toBe("light");
  });

  it("updates when preferences://changed event is received", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "light",
          "workbench.sideBar.location": "left",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().darkMode).toBe("light");

    emitMockEvent("preferences://changed", {
      "workbench.colorTheme": "monokai",
      "workbench.darkMode": "dark",
      "workbench.sideBar.location": "right",
    });

    const state = usePreferencesStore.getState();
    expect(state.darkMode).toBe("dark");
    expect(state.colorTheme).toBe("monokai");
    expect(state.sidebarLocation).toBe("right");
  });

  it("handles IPC failure gracefully", async () => {
    mockInvoke(() => {
      throw new Error("IPC unavailable");
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();

    const state = usePreferencesStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.darkMode).toBe("auto");
    expect(state.sidebarLocation).toBe("left");
  });

  it("treats unknown sidebarLocation values as left", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "invalid",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().sidebarLocation).toBe("left");
  });
});
