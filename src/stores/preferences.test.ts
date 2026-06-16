import { describe, it, expect, beforeEach } from "vitest";
import {
  usePreferencesStore,
  migrateLlmProvider,
  addCustomProvider,
  updateCustomProvider,
  removeCustomProvider,
  setCompanionSearchPath,
  setSearchEnabledProviders,
} from "./preferences";
import type { Preferences } from "../lib/ipc";
import type { CustomProviderDef } from "../lib/providerRegistry";
import { mockInvoke, mockListen, emitMockEvent } from "../test/tauri-mock";

describe("PreferencesStore", () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      darkMode: "auto",
      colorTheme: null,
      sidebarVisible: true,
      sidebarLocation: "left",
      bottomPanelPosition: "bottom",
      crossrefEnabled: true,
      crossrefLiveRendering: true,
      crossrefEnableCiteproc: true,
      mediaThumbnails: true,
      experimentalUnlinkedReferences: true,
      neighborsDepth: 1,
      llmCustomProviders: [],
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

  it("defaults annotationDisplayMode to 'pill'", () => {
    const state = usePreferencesStore.getState();
    expect(state.annotationDisplayMode).toBe("pill");
  });

  it("maps annotations.displayMode: 'footnote' from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "annotations.displayMode": "footnote",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().annotationDisplayMode).toBe("footnote");
  });

  it("falls back to 'pill' when annotations.displayMode key is missing", async () => {
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
    expect(usePreferencesStore.getState().annotationDisplayMode).toBe("pill");
  });

  it("falls back to 'pill' when annotations.displayMode is invalid", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "annotations.displayMode": "bogus",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().annotationDisplayMode).toBe("pill");
  });

  it("updates annotationDisplayMode on preferences://changed event", async () => {
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
    expect(usePreferencesStore.getState().annotationDisplayMode).toBe("pill");

    emitMockEvent("preferences://changed", {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
      "annotations.displayMode": "footnote",
    });

    expect(usePreferencesStore.getState().annotationDisplayMode).toBe("footnote");
  });

  it("defaults annotationEnabled to true", () => {
    const state = usePreferencesStore.getState();
    expect(state.annotationEnabled).toBe(true);
  });

  it("maps annotations.enabled: false from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "annotations.enabled": false,
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().annotationEnabled).toBe(false);
  });

  it("defaults annotationEnabled to true when key missing from IPC", async () => {
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
    expect(usePreferencesStore.getState().annotationEnabled).toBe(true);
  });

  it("updates annotationEnabled on preferences://changed event", async () => {
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
    expect(usePreferencesStore.getState().annotationEnabled).toBe(true);

    emitMockEvent("preferences://changed", {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
      "annotations.enabled": false,
    });

    expect(usePreferencesStore.getState().annotationEnabled).toBe(false);
  });

  it("defaults annotationScopeHighlight to true", () => {
    const state = usePreferencesStore.getState();
    expect(state.annotationScopeHighlight).toBe(true);
  });

  it("maps annotations.scopeHighlight: false from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "annotations.scopeHighlight": false,
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().annotationScopeHighlight).toBe(false);
  });

  it("defaults annotationScopeHighlight to true when key missing from IPC", async () => {
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
    expect(usePreferencesStore.getState().annotationScopeHighlight).toBe(true);
  });

  it("updates annotationScopeHighlight on preferences://changed event", async () => {
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
    expect(usePreferencesStore.getState().annotationScopeHighlight).toBe(true);

    emitMockEvent("preferences://changed", {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
      "annotations.scopeHighlight": false,
    });

    expect(usePreferencesStore.getState().annotationScopeHighlight).toBe(false);
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

  it("defaults sidebarVisible to true", () => {
    const state = usePreferencesStore.getState();
    expect(state.sidebarVisible).toBe(true);
  });

  it("maps workbench.sideBar.visible: false from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "workbench.sideBar.visible": false,
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().sidebarVisible).toBe(false);
  });

  it("defaults sidebarVisible to true when key missing from IPC", async () => {
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
    expect(usePreferencesStore.getState().sidebarVisible).toBe(true);
  });

  it("updates sidebarVisible on preferences://changed event", async () => {
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
    expect(usePreferencesStore.getState().sidebarVisible).toBe(true);

    emitMockEvent("preferences://changed", {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
      "workbench.sideBar.visible": false,
    });

    expect(usePreferencesStore.getState().sidebarVisible).toBe(false);
  });

  describe("llm type-specific prompts", () => {
    it("defaults llmPromptLlm to non-empty string", () => {
      const state = usePreferencesStore.getState();
      expect(state.llmPromptLlm).toBeTruthy();
    });

    it("defaults all 3 prompt fields to non-empty strings", () => {
      const state = usePreferencesStore.getState();
      expect(state.llmPromptLlm).toBeTruthy();
      expect(state.llmPromptTr).toBeTruthy();
      expect(state.llmPromptQ).toBeTruthy();
    });

    it("maps llm.prompts.* from IPC", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_preferences") {
          return {
            "workbench.colorTheme": null,
            "workbench.darkMode": "auto",
            "workbench.sideBar.location": "left",
            "llm.prompts.llm": "Custom llm prompt",
            "llm.prompts.q": "Custom question prompt",
          };
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
      mockListen();

      await usePreferencesStore.getState().loadPreferences();
      expect(usePreferencesStore.getState().llmPromptLlm).toBe("Custom llm prompt");
      expect(usePreferencesStore.getState().llmPromptQ).toBe("Custom question prompt");
    });

    it("uses defaults when llm.prompts.* keys are missing from IPC", async () => {
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
      expect(state.llmPromptLlm).toContain("instruction");
      expect(state.llmPromptTr).toContain("Translate");
      expect(state.llmPromptQ).toContain("question");
    });

    it("updates prompts on preferences://changed event", async () => {
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

      emitMockEvent("preferences://changed", {
        "workbench.colorTheme": null,
        "workbench.darkMode": "auto",
        "workbench.sideBar.location": "left",
        "llm.prompts.llm": "Updated prompt",
      });

      expect(usePreferencesStore.getState().llmPromptLlm).toBe("Updated prompt");
    });
  });

  it("defaults neighborsDepth to 1", () => {
    const state = usePreferencesStore.getState();
    expect(state.neighborsDepth).toBe(1);
  });

  it("maps llm.neighborsDepth from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "llm.neighborsDepth": 2,
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().neighborsDepth).toBe(2);
  });

  it("defaults neighborsDepth to 1 when key missing from IPC", async () => {
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
    expect(usePreferencesStore.getState().neighborsDepth).toBe(1);
  });

  it("updates neighborsDepth on preferences://changed event", async () => {
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
    expect(usePreferencesStore.getState().neighborsDepth).toBe(1);

    emitMockEvent("preferences://changed", {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
      "llm.neighborsDepth": 0,
    });

    expect(usePreferencesStore.getState().neighborsDepth).toBe(0);
  });

  // --- Graph View ---

  it("defaults graphViewEnabled to false", () => {
    const state = usePreferencesStore.getState();
    expect(state.graphViewEnabled).toBe(false);
  });

  it("maps workbench.graphView.enabled: true from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "workbench.graphView.enabled": true,
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().graphViewEnabled).toBe(true);
  });

  it("defaults graphViewEnabled to false when key missing from IPC", async () => {
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
    expect(usePreferencesStore.getState().graphViewEnabled).toBe(false);
  });

  it("updates graphViewEnabled on preferences://changed event", async () => {
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
    expect(usePreferencesStore.getState().graphViewEnabled).toBe(false);

    emitMockEvent("preferences://changed", {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
      "workbench.graphView.enabled": true,
    });

    expect(usePreferencesStore.getState().graphViewEnabled).toBe(true);
  });

  // --- Academic Export fields ---

  it("defaults academicPandocPath to empty string", () => {
    const state = usePreferencesStore.getState();
    expect(state.academicPandocPath).toBe("");
  });

  it("defaults academicCrossrefPath to empty string", () => {
    const state = usePreferencesStore.getState();
    expect(state.academicCrossrefPath).toBe("");
  });

  it("defaults academicPdfEngine to empty string", () => {
    const state = usePreferencesStore.getState();
    expect(state.academicPdfEngine).toBe("");
  });

  it("defaults academicDefaultCsl to empty string", () => {
    const state = usePreferencesStore.getState();
    expect(state.academicDefaultCsl).toBe("");
  });

  it("defaults academicDefaultTemplate to empty string", () => {
    const state = usePreferencesStore.getState();
    expect(state.academicDefaultTemplate).toBe("");
  });

  it("defaults academicDefaultReferenceDoc to empty string", () => {
    const state = usePreferencesStore.getState();
    expect(state.academicDefaultReferenceDoc).toBe("");
  });

  // --- Companion search path ---

  it("defaults companionSearchPath to ['.']", () => {
    expect(usePreferencesStore.getState().companionSearchPath).toEqual(["."]);
  });

  it("maps companion.searchPath array from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "companion.searchPath": [".", "pdfs"],
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().companionSearchPath).toEqual([".", "pdfs"]);
  });

  it("defaults companionSearchPath to ['.'] when key missing from IPC", async () => {
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
    expect(usePreferencesStore.getState().companionSearchPath).toEqual(["."]);
  });

  it("defaults companionSearchPath to ['.'] for non-array value", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "companion.searchPath": "pdfs",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().companionSearchPath).toEqual(["."]);
  });

  it("updates companionSearchPath on preferences://changed event", async () => {
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
    expect(usePreferencesStore.getState().companionSearchPath).toEqual(["."]);

    emitMockEvent("preferences://changed", {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
      "companion.searchPath": ["pdfs", "."],
    });

    expect(usePreferencesStore.getState().companionSearchPath).toEqual(["pdfs", "."]);
  });

  it("setCompanionSearchPath updates store and persists", async () => {
    usePreferencesStore.setState({ companionSearchPath: ["."] });
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    mockInvoke((cmd, args) => {
      calls.push({ cmd, args });
      return undefined;
    });

    setCompanionSearchPath([".", "pdfs"]);
    await Promise.resolve();

    expect(usePreferencesStore.getState().companionSearchPath).toEqual([".", "pdfs"]);
    const setCall = calls.find((c) => c.cmd === "set_preference");
    expect(setCall).toBeDefined();
    expect(setCall?.args?.key).toBe("companion.searchPath");
    expect(setCall?.args?.value).toEqual([".", "pdfs"]);
  });

  it("setCompanionSearchPath rolls back when persistence rejects", async () => {
    usePreferencesStore.setState({ companionSearchPath: ["."] });
    mockInvoke((cmd) =>
      cmd === "set_preference" ? Promise.reject(new Error("write failed")) : undefined,
    );

    setCompanionSearchPath([".", "pdfs"]);
    await new Promise((r) => setTimeout(r, 0));

    expect(usePreferencesStore.getState().companionSearchPath).toEqual(["."]);
  });

  it("setCompanionSearchPath does not clobber a newer value when an earlier call's persistence rejects", async () => {
    usePreferencesStore.setState({ companionSearchPath: ["."] });
    let setPreferenceCalls = 0;
    mockInvoke((cmd) => {
      if (cmd === "set_preference") {
        setPreferenceCalls += 1;
        // First call (A) rejects late; second call (B) resolves.
        return setPreferenceCalls === 1
          ? Promise.reject(new Error("write failed"))
          : undefined;
      }
      return undefined;
    });

    setCompanionSearchPath([".", "a"]); // A — will reject
    setCompanionSearchPath([".", "b"]); // B — will resolve, supersedes A
    await new Promise((r) => setTimeout(r, 0));

    // A's stale rollback must not clobber B's value.
    expect(usePreferencesStore.getState().companionSearchPath).toEqual([".", "b"]);
  });

  it("setCompanionSearchPath normalizes empty array to ['.'] in store and persistence", async () => {
    usePreferencesStore.setState({ companionSearchPath: [".", "pdfs"] });
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    mockInvoke((cmd, args) => {
      calls.push({ cmd, args });
      return undefined;
    });

    setCompanionSearchPath([]);
    await Promise.resolve();

    expect(usePreferencesStore.getState().companionSearchPath).toEqual(["."]);
    const setCall = calls.find((c) => c.cmd === "set_preference");
    expect(setCall).toBeDefined();
    expect(setCall?.args?.key).toBe("companion.searchPath");
    expect(setCall?.args?.value).toEqual(["."]);
  });

  it("setCompanionSearchPath filters non-string entries", async () => {
    usePreferencesStore.setState({ companionSearchPath: ["."] });
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    mockInvoke((cmd, args) => {
      calls.push({ cmd, args });
      return undefined;
    });

    setCompanionSearchPath(["pdfs", 5 as unknown as string, "."]);
    await Promise.resolve();

    expect(usePreferencesStore.getState().companionSearchPath).toEqual(["pdfs", "."]);
    const setCall = calls.find((c) => c.cmd === "set_preference");
    expect(setCall?.args?.value).toEqual(["pdfs", "."]);
  });

  it("maps academic.pandocPath from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "academic.pandocPath": "/usr/local/bin/pandoc",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().academicPandocPath).toBe("/usr/local/bin/pandoc");
  });

  it("maps academic.crossrefFilterPath from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "academic.crossrefFilterPath": "/usr/local/bin/pandoc-crossref",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().academicCrossrefPath).toBe("/usr/local/bin/pandoc-crossref");
  });

  it("maps academic.pdfEngine from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "academic.pdfEngine": "xelatex",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().academicPdfEngine).toBe("xelatex");
  });

  it("maps academic.defaultCsl from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "academic.defaultCsl": "ieee",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().academicDefaultCsl).toBe("ieee");
  });

  it("maps academic.defaultTemplate from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "academic.defaultTemplate": "/path/to/template.tex",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().academicDefaultTemplate).toBe("/path/to/template.tex");
  });

  it("maps academic.defaultReferenceDoc from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "academic.defaultReferenceDoc": "/path/to/reference.docx",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().academicDefaultReferenceDoc).toBe("/path/to/reference.docx");
  });

  it("defaults academic fields to empty string when keys missing from IPC", async () => {
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
    expect(state.academicPandocPath).toBe("");
    expect(state.academicCrossrefPath).toBe("");
    expect(state.academicPdfEngine).toBe("");
    expect(state.academicDefaultCsl).toBe("");
    expect(state.academicDefaultTemplate).toBe("");
    expect(state.academicDefaultReferenceDoc).toBe("");
  });

  it("updates academic fields on preferences://changed event", async () => {
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
    expect(usePreferencesStore.getState().academicPandocPath).toBe("");

    emitMockEvent("preferences://changed", {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
      "academic.pandocPath": "/opt/pandoc",
      "academic.pdfEngine": "lualatex",
    });

    const state = usePreferencesStore.getState();
    expect(state.academicPandocPath).toBe("/opt/pandoc");
    expect(state.academicPdfEngine).toBe("lualatex");
  });

  it("defaults bottomPanelPosition to 'bottom'", () => {
    const state = usePreferencesStore.getState();
    expect(state.bottomPanelPosition).toBe("bottom");
  });

  it("maps workbench.bottomPanel.position: 'side' from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "workbench.bottomPanel.position": "side",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().bottomPanelPosition).toBe("side");
  });

  it("defaults bottomPanelPosition to 'bottom' when key missing from IPC", async () => {
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
    expect(usePreferencesStore.getState().bottomPanelPosition).toBe("bottom");
  });

  it("treats unknown bottomPanelPosition values as 'bottom'", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "workbench.bottomPanel.position": "invalid",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().bottomPanelPosition).toBe("bottom");
  });

  it("updates bottomPanelPosition on preferences://changed event", async () => {
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
    expect(usePreferencesStore.getState().bottomPanelPosition).toBe("bottom");

    emitMockEvent("preferences://changed", {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
      "workbench.bottomPanel.position": "side",
    });

    expect(usePreferencesStore.getState().bottomPanelPosition).toBe("side");
  });

  // --- Annotation builder defaults ---

  it("defaults annotationPrefillLastUsed to false", () => {
    const state = usePreferencesStore.getState();
    expect(state.annotationPrefillLastUsed).toBe(false);
  });

  it("defaults annotationBuilderDefaults to null", () => {
    const state = usePreferencesStore.getState();
    expect(state.annotationBuilderDefaults).toBeNull();
  });

  it("maps annotations.prefillLastUsed: true from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "annotations.prefillLastUsed": true,
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().annotationPrefillLastUsed).toBe(true);
  });

  it("maps valid annotations.builderDefaults from IPC", async () => {
    const defaults = {
      type: "question",
      certainty: "firm",
      scopeKind: "paragraph",
      scopeCount: 2,
      asymmetric: false,
      scopeAfter: 1,
    };
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "annotations.builderDefaults": defaults,
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().annotationBuilderDefaults).toEqual(defaults);
  });

  describe("migrateLlmProvider", () => {
    const base: Preferences = {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
      "editor.folding.enabled": true,
      "editor.folding.showFoldingControls": "mouseover",
      "workbench.defaultViewMode": "editor",
    };

    it("synthesizes anthropic provider from legacy claude model", () => {
      const result = migrateLlmProvider({ ...base, "llm.model": "claude-sonnet-4-6" });
      expect(result.providerId).toBe("anthropic");
      expect(result.model).toBe("claude-sonnet-4-6");
      expect(result.apiKeySet).toBe(false);
    });

    it("synthesizes openai provider from legacy gpt model", () => {
      const result = migrateLlmProvider({ ...base, "llm.model": "gpt-4o" });
      expect(result.providerId).toBe("openai");
      expect(result.model).toBe("gpt-4o");
    });

    it("copies anthropic baseUrl for claude model", () => {
      const result = migrateLlmProvider({
        ...base,
        "llm.model": "claude-sonnet-4-6",
        "llm.anthropic.baseUrl": "https://custom.anthropic.com",
      });
      expect(result.baseUrl).toBe("https://custom.anthropic.com");
    });

    it("copies openai baseUrl for gpt model", () => {
      const result = migrateLlmProvider({
        ...base,
        "llm.model": "gpt-4o",
        "llm.openai.baseUrl": "https://custom.openai.com",
      });
      expect(result.baseUrl).toBe("https://custom.openai.com");
    });

    it("normalizes empty baseUrl to undefined", () => {
      const result = migrateLlmProvider({
        ...base,
        "llm.model": "claude-sonnet-4-6",
        "llm.anthropic.baseUrl": "",
      });
      expect(result.baseUrl).toBeUndefined();
    });

    it("normalizes whitespace-only baseUrl to undefined", () => {
      const result = migrateLlmProvider({
        ...base,
        "llm.model": "gpt-4o",
        "llm.openai.baseUrl": "  ",
      });
      expect(result.baseUrl).toBeUndefined();
    });

    it("uses post-migration llm.provider object directly", () => {
      const result = migrateLlmProvider({
        ...base,
        "llm.provider": {
          providerId: "openrouter",
          model: "meta-llama/llama-3-70b",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKeySet: true,
        },
      });
      expect(result.providerId).toBe("openrouter");
      expect(result.model).toBe("meta-llama/llama-3-70b");
      expect(result.baseUrl).toBe("https://openrouter.ai/api/v1");
      expect(result.apiKeySet).toBe(true);
    });

    it("defaults model when persisted llm.provider model is empty string", () => {
      const result = migrateLlmProvider({
        ...base,
        "llm.provider": {
          providerId: "anthropic",
          model: "",
          apiKeySet: false,
        },
      });
      expect(result.model).toBe("claude-sonnet-4-6");
    });

    it("defaults to claude-sonnet-4-6 when llm.model is missing", () => {
      const result = migrateLlmProvider(base);
      expect(result.model).toBe("claude-sonnet-4-6");
      expect(result.providerId).toBe("anthropic");
    });
  });

  it("loadPreferences integration: legacy gpt model migrates to openai provider", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "llm.model": "gpt-4o",
          "llm.openai.baseUrl": "https://custom.openai.com",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    const state = usePreferencesStore.getState();
    expect(state.llmProvider.providerId).toBe("openai");
    expect(state.llmProvider.model).toBe("gpt-4o");
    expect(state.llmProvider.baseUrl).toBe("https://custom.openai.com");
    expect(state.llmProvider.apiKeySet).toBe(false);
  });

  it("loadPreferences corrects apiKeySet via has_api_key for legacy users with a saved key", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "llm.model": "claude-sonnet-4-6",
        };
      }
      if (cmd === "has_api_key") {
        return true;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    // Flush the fire-and-forget has_api_key check that runs after the set().
    await new Promise((r) => setTimeout(r, 0));

    const state = usePreferencesStore.getState();
    expect(state.llmProvider.providerId).toBe("anthropic");
    expect(state.llmProvider.apiKeySet).toBe(true);
  });

  it("loadPreferences leaves apiKeySet false when has_api_key returns false", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "llm.model": "claude-sonnet-4-6",
        };
      }
      if (cmd === "has_api_key") {
        return false;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    await new Promise((r) => setTimeout(r, 0));

    const state = usePreferencesStore.getState();
    expect(state.llmProvider.providerId).toBe("anthropic");
    expect(state.llmProvider.apiKeySet).toBe(false);
  });

  it("loadPreferences persists the migrated llm.provider when none existed on disk", async () => {
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    mockInvoke((cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "llm.model": "gpt-4o",
          "llm.openai.baseUrl": "https://custom.openai.com",
        };
      }
      if (cmd === "has_api_key") return false;
      return undefined;
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    await new Promise((r) => setTimeout(r, 0));

    const providerWrites = calls.filter(
      (c) => c.cmd === "set_preference" && c.args?.key === "llm.provider",
    );
    expect(providerWrites).toHaveLength(1);
    expect(providerWrites[0]?.args?.value).toEqual({
      providerId: "openai",
      model: "gpt-4o",
      baseUrl: "https://custom.openai.com",
      apiKeySet: false,
    });
  });

  it("loadPreferences does NOT persist llm.provider when it already exists on disk", async () => {
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    mockInvoke((cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "llm.provider": {
            providerId: "openrouter",
            model: "anthropic/claude-3.5-sonnet",
            apiKeySet: true,
          },
        };
      }
      if (cmd === "has_api_key") return false;
      return undefined;
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    await new Promise((r) => setTimeout(r, 0));

    const providerWrites = calls.filter(
      (c) => c.cmd === "set_preference" && c.args?.key === "llm.provider",
    );
    expect(providerWrites).toHaveLength(0);
  });

  it("maps invalid annotations.builderDefaults to null", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "annotations.builderDefaults": { type: 123, bogus: true },
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().annotationBuilderDefaults).toBeNull();
  });

  it("maps missing annotations.builderDefaults to null", async () => {
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
    expect(usePreferencesStore.getState().annotationBuilderDefaults).toBeNull();
  });

  describe("llmCustomProviders", () => {
    const sampleDef: CustomProviderDef = {
      id: "custom-vllm",
      name: "My vLLM",
      baseUrl: "http://localhost:8000/v1",
      needsApiKey: true,
      modelId: "qwen",
      contextWindow: 32000,
    };

    const baseGet = {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
    };

    it("defaults to []", () => {
      expect(usePreferencesStore.getState().llmCustomProviders).toEqual([]);
    });

    it("parses a valid llm.customProviders array from IPC", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_preferences") {
          return { ...baseGet, "llm.customProviders": [sampleDef] };
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
      mockListen();

      await usePreferencesStore.getState().loadPreferences();
      const state = usePreferencesStore.getState();
      expect(state.llmCustomProviders).toHaveLength(1);
      expect(state.llmCustomProviders).toEqual([sampleDef]);
    });

    it("defaults to [] when llm.customProviders key is missing", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_preferences") return { ...baseGet };
        throw new Error(`Unknown command: ${cmd}`);
      });
      mockListen();

      await usePreferencesStore.getState().loadPreferences();
      expect(usePreferencesStore.getState().llmCustomProviders).toEqual([]);
    });

    it("defaults to [] when llm.customProviders is not an array", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_preferences") {
          return { ...baseGet, "llm.customProviders": "not-an-array" };
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
      mockListen();

      await usePreferencesStore.getState().loadPreferences();
      expect(usePreferencesStore.getState().llmCustomProviders).toEqual([]);
    });

    it("defaults to [] when an entry is malformed", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_preferences") {
          return {
            ...baseGet,
            "llm.customProviders": [{ id: "custom-x", name: "X" }],
          };
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
      mockListen();

      await usePreferencesStore.getState().loadPreferences();
      expect(usePreferencesStore.getState().llmCustomProviders).toEqual([]);
    });

    it("keeps valid entries and drops only the malformed ones in a mixed array", async () => {
      const invalidDef = {
        id: "custom-broken",
        name: "Broken",
        baseUrl: "http://localhost:9000/v1",
        needsApiKey: true,
        modelId: "m",
        // contextWindow omitted -> fails isCustomProviderDef
      };
      mockInvoke((cmd) => {
        if (cmd === "get_preferences") {
          return {
            ...baseGet,
            "llm.customProviders": [sampleDef, invalidDef],
          };
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
      mockListen();

      await usePreferencesStore.getState().loadPreferences();
      const state = usePreferencesStore.getState();
      expect(state.llmCustomProviders).toHaveLength(1);
      expect(state.llmCustomProviders).toEqual([sampleDef]);
    });

    it("updates llmCustomProviders on preferences://changed event", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_preferences") return { ...baseGet };
        throw new Error(`Unknown command: ${cmd}`);
      });
      mockListen();

      await usePreferencesStore.getState().loadPreferences();
      expect(usePreferencesStore.getState().llmCustomProviders).toEqual([]);

      emitMockEvent("preferences://changed", {
        ...baseGet,
        "llm.customProviders": [sampleDef],
      });

      expect(usePreferencesStore.getState().llmCustomProviders).toEqual([sampleDef]);
    });

    it("addCustomProvider appends and persists", async () => {
      usePreferencesStore.setState({ llmCustomProviders: [] });
      const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
      mockInvoke((cmd, args) => {
        calls.push({ cmd, args });
        return undefined;
      });

      addCustomProvider(sampleDef);
      await Promise.resolve();

      expect(usePreferencesStore.getState().llmCustomProviders).toEqual([sampleDef]);
      const setCall = calls.find((c) => c.cmd === "set_preference");
      expect(setCall).toBeDefined();
      expect(setCall?.args?.key).toBe("llm.customProviders");
      expect(setCall?.args?.value).toEqual([sampleDef]);
    });

    it("updateCustomProvider patches in place and persists", async () => {
      usePreferencesStore.setState({ llmCustomProviders: [sampleDef] });
      const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
      mockInvoke((cmd, args) => {
        calls.push({ cmd, args });
        return undefined;
      });

      updateCustomProvider("custom-vllm", { contextWindow: 64000 });
      await Promise.resolve();

      const updated = usePreferencesStore.getState().llmCustomProviders;
      expect(updated).toHaveLength(1);
      expect(updated[0]).toEqual({ ...sampleDef, contextWindow: 64000 });

      const setCall = calls.find((c) => c.cmd === "set_preference");
      expect(setCall?.args?.value).toEqual([{ ...sampleDef, contextWindow: 64000 }]);
    });

    it("updateCustomProvider is a no-op when id is not found", async () => {
      usePreferencesStore.setState({ llmCustomProviders: [sampleDef] });
      mockInvoke(() => undefined);

      updateCustomProvider("custom-missing", { contextWindow: 99999 });
      await Promise.resolve();

      expect(usePreferencesStore.getState().llmCustomProviders).toEqual([sampleDef]);
    });

    it("removeCustomProvider filters, persists, and deletes the api key", async () => {
      usePreferencesStore.setState({ llmCustomProviders: [sampleDef] });
      const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
      mockInvoke((cmd, args) => {
        calls.push({ cmd, args });
        return undefined;
      });

      removeCustomProvider("custom-vllm");
      await Promise.resolve();

      expect(usePreferencesStore.getState().llmCustomProviders).toEqual([]);

      const setCall = calls.find((c) => c.cmd === "set_preference");
      expect(setCall?.args?.key).toBe("llm.customProviders");
      expect(setCall?.args?.value).toEqual([]);

      const delCall = calls.find((c) => c.cmd === "delete_api_key");
      expect(delCall).toBeDefined();
      expect(delCall?.args?.provider).toBe("custom-vllm");
    });

    it("addCustomProvider rolls back when persistence rejects", async () => {
      usePreferencesStore.setState({ llmCustomProviders: [] });
      mockInvoke((cmd) => {
        if (cmd === "set_preference") {
          return Promise.reject(new Error("write failed"));
        }
        return undefined;
      });

      addCustomProvider(sampleDef);
      // flush the optimistic update + the rejected promise's .catch rollback
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(usePreferencesStore.getState().llmCustomProviders).toEqual([]);
    });
  });

  // --- searchEnabledProviders hydration ---

  describe("searchEnabledProviders hydration", () => {
    const ALL_PROVIDERS = [
      "openalex", "crossref", "base", "pubmed", "biorxiv",
      "semantic_scholar", "openreview", "arxiv",
      "unpaywall", "core", "zenodo", "doaj",
      "open_library", "google_books", "hathitrust",
    ];

    it("keeps all providers enabled when search.enabledProviders key is absent (fresh install)", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_preferences") {
          return {
            "workbench.colorTheme": null,
            "workbench.darkMode": "auto",
            "workbench.sideBar.location": "left",
            // No "search.enabledProviders" key — simulates fresh install
          };
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
      mockListen();

      await usePreferencesStore.getState().loadPreferences();
      expect(usePreferencesStore.getState().searchEnabledProviders).toEqual(ALL_PROVIDERS);
    });

    it("uses stored array when search.enabledProviders is present", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_preferences") {
          return {
            "workbench.colorTheme": null,
            "workbench.darkMode": "auto",
            "workbench.sideBar.location": "left",
            "search.enabledProviders": ["crossref", "arxiv"],
          };
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
      mockListen();

      await usePreferencesStore.getState().loadPreferences();
      expect(usePreferencesStore.getState().searchEnabledProviders).toEqual(["crossref", "arxiv"]);
    });

    it("uses empty array when search.enabledProviders is explicitly [] (user disabled all)", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_preferences") {
          return {
            "workbench.colorTheme": null,
            "workbench.darkMode": "auto",
            "workbench.sideBar.location": "left",
            "search.enabledProviders": [],
          };
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
      mockListen();

      await usePreferencesStore.getState().loadPreferences();
      expect(usePreferencesStore.getState().searchEnabledProviders).toEqual([]);
    });

    it("keeps all providers when search.enabledProviders key is absent on preferences://changed event", async () => {
      // Set initial state to all providers
      usePreferencesStore.setState({ searchEnabledProviders: ALL_PROVIDERS });

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

      // Fire a changed event without the key
      emitMockEvent("preferences://changed", {
        "workbench.colorTheme": null,
        "workbench.darkMode": "auto",
        "workbench.sideBar.location": "left",
      });

      // Should preserve the existing value, not overwrite with []
      expect(usePreferencesStore.getState().searchEnabledProviders).toEqual(ALL_PROVIDERS);
    });

    it("setSearchEnabledProviders updates store and persists", async () => {
      usePreferencesStore.setState({ searchEnabledProviders: ALL_PROVIDERS });
      const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
      mockInvoke((cmd, args) => {
        calls.push({ cmd, args });
        return undefined;
      });

      setSearchEnabledProviders(["crossref", "arxiv"]);
      await Promise.resolve();

      expect(usePreferencesStore.getState().searchEnabledProviders).toEqual(["crossref", "arxiv"]);
      const setCall = calls.find((c) => c.cmd === "set_preference");
      expect(setCall).toBeDefined();
      expect(setCall?.args?.key).toBe("search.enabledProviders");
      expect(setCall?.args?.value).toEqual(["crossref", "arxiv"]);
    });

    it("setSearchEnabledProviders rolls back when persistence rejects", async () => {
      usePreferencesStore.setState({ searchEnabledProviders: ALL_PROVIDERS });
      mockInvoke((cmd) =>
        cmd === "set_preference" ? Promise.reject(new Error("write failed")) : undefined,
      );

      setSearchEnabledProviders(["crossref"]);
      await new Promise((r) => setTimeout(r, 0));

      expect(usePreferencesStore.getState().searchEnabledProviders).toEqual(ALL_PROVIDERS);
    });

    it("setSearchEnabledProviders with empty array persists [] (user disabled all)", async () => {
      usePreferencesStore.setState({ searchEnabledProviders: ALL_PROVIDERS });
      const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
      mockInvoke((cmd, args) => {
        calls.push({ cmd, args });
        return undefined;
      });

      setSearchEnabledProviders([]);
      await Promise.resolve();

      expect(usePreferencesStore.getState().searchEnabledProviders).toEqual([]);
      const setCall = calls.find((c) => c.cmd === "set_preference");
      expect(setCall?.args?.value).toEqual([]);
    });
  });
});
