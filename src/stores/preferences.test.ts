import { describe, it, expect, beforeEach } from "vitest";
import { usePreferencesStore } from "./preferences";
import { mockInvoke, mockListen, emitMockEvent } from "../test/tauri-mock";

describe("PreferencesStore", () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      darkMode: "auto",
      colorTheme: null,
      sidebarLocation: "left",
      crossrefEnabled: true,
      crossrefLiveRendering: true,
      crossrefEnableCiteproc: true,
      mediaThumbnails: true,
      experimentalUnlinkedReferences: true,
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

  it("defaults crossref fields to true", () => {
    const state = usePreferencesStore.getState();
    expect(state.crossrefEnabled).toBe(true);
    expect(state.crossrefLiveRendering).toBe(true);
    expect(state.crossrefEnableCiteproc).toBe(true);
  });

  it("loads crossref fields set to false from preferences", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "crossref.enabled": false,
          "crossref.liveRendering": false,
          "crossref.enableCiteproc": false,
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();

    const state = usePreferencesStore.getState();
    expect(state.crossrefEnabled).toBe(false);
    expect(state.crossrefLiveRendering).toBe(false);
    expect(state.crossrefEnableCiteproc).toBe(false);
  });

  it("defaults crossref to true when keys are missing from IPC response", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();

    const state = usePreferencesStore.getState();
    expect(state.crossrefEnabled).toBe(true);
    expect(state.crossrefLiveRendering).toBe(true);
    expect(state.crossrefEnableCiteproc).toBe(true);
  });

  it("updates crossref fields on preferences://changed event", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "crossref.enabled": true,
          "crossref.liveRendering": true,
          "crossref.enableCiteproc": true,
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().crossrefLiveRendering).toBe(true);

    emitMockEvent("preferences://changed", {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
      "crossref.enabled": true,
      "crossref.liveRendering": false,
      "crossref.enableCiteproc": true,
    });

    const state = usePreferencesStore.getState();
    expect(state.crossrefEnabled).toBe(true);
    expect(state.crossrefLiveRendering).toBe(false);
    expect(state.crossrefEnableCiteproc).toBe(true);
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

  it("defaults mediaThumbnails to true", () => {
    const state = usePreferencesStore.getState();
    expect(state.mediaThumbnails).toBe(true);
  });

  it("maps editor.mediaThumbnails false from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "editor.mediaThumbnails": false,
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().mediaThumbnails).toBe(false);
  });

  it("defaults mediaThumbnails to true when key missing from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().mediaThumbnails).toBe(true);
  });

  it("updates mediaThumbnails on preferences://changed event", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().mediaThumbnails).toBe(true);

    emitMockEvent("preferences://changed", {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
      "editor.mediaThumbnails": false,
    });

    expect(usePreferencesStore.getState().mediaThumbnails).toBe(false);
  });

  it("defaults experimentalUnlinkedReferences to true", () => {
    const state = usePreferencesStore.getState();
    expect(state.experimentalUnlinkedReferences).toBe(true);
  });

  it("maps experimental.unlinkedReferences true from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "experimental.unlinkedReferences": true,
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().experimentalUnlinkedReferences).toBe(true);
  });

  it("defaults experimentalUnlinkedReferences to true when key missing from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().experimentalUnlinkedReferences).toBe(true);
  });

  it("defaults annotationDefaultLang to 'en'", () => {
    const state = usePreferencesStore.getState();
    expect(state.annotationDefaultLang).toBe("en");
  });

  it("maps annotations.defaultLang from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "annotations.defaultLang": "zh",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().annotationDefaultLang).toBe("zh");
  });

  it("defaults annotationDefaultLang to 'en' when key missing from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().annotationDefaultLang).toBe("en");
  });

  it("updates experimentalUnlinkedReferences on preferences://changed event", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().experimentalUnlinkedReferences).toBe(true);

    emitMockEvent("preferences://changed", {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
      "experimental.unlinkedReferences": false,
    });

    expect(usePreferencesStore.getState().experimentalUnlinkedReferences).toBe(false);
  });
});
