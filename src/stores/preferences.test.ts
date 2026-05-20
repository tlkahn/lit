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

    it("defaults all 7 prompt fields to non-empty strings", () => {
      const state = usePreferencesStore.getState();
      expect(state.llmPromptLlm).toBeTruthy();
      expect(state.llmPromptTodo).toBeTruthy();
      expect(state.llmPromptTr).toBeTruthy();
      expect(state.llmPromptQ).toBeTruthy();
      expect(state.llmPromptN).toBeTruthy();
      expect(state.llmPromptCf).toBeTruthy();
      expect(state.llmPromptApp).toBeTruthy();
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
      expect(state.llmPromptTodo).toContain("task");
      expect(state.llmPromptTr).toContain("Translate");
      expect(state.llmPromptQ).toContain("question");
      expect(state.llmPromptN).toContain("note");
      expect(state.llmPromptCf).toContain("cross-reference");
      expect(state.llmPromptApp).toContain("commentary");
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
});
