import { describe, it, expect, beforeEach } from "vitest";
import { usePreferencesStore } from "./preferences";
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

  it("defaults llmDeleteAnnotationThreads to false", () => {
    const state = usePreferencesStore.getState();
    expect(state.llmDeleteAnnotationThreads).toBe(false);
  });

  it("maps llm.deleteAnnotationThreads: true from IPC", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences") {
        return {
          "workbench.colorTheme": null,
          "workbench.darkMode": "auto",
          "workbench.sideBar.location": "left",
          "llm.deleteAnnotationThreads": true,
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    mockListen();

    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().llmDeleteAnnotationThreads).toBe(true);
  });

  it("defaults llmDeleteAnnotationThreads to false when key missing from IPC", async () => {
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
    expect(usePreferencesStore.getState().llmDeleteAnnotationThreads).toBe(false);
  });

  it("updates llmDeleteAnnotationThreads on preferences://changed event", async () => {
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
    expect(usePreferencesStore.getState().llmDeleteAnnotationThreads).toBe(false);

    emitMockEvent("preferences://changed", {
      "workbench.colorTheme": null,
      "workbench.darkMode": "auto",
      "workbench.sideBar.location": "left",
      "llm.deleteAnnotationThreads": true,
    });

    expect(usePreferencesStore.getState().llmDeleteAnnotationThreads).toBe(true);
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
});
