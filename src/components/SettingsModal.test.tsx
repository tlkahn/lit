import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { mockInvoke } from "../test/tauri-mock";
import { usePreferencesStore } from "../stores/preferences";

const defaults = {
  darkMode: "auto" as const,
  colorTheme: null,
  sidebarVisible: true,
  sidebarLocation: "left" as const,
  foldingEnabled: true,
  foldingShowControls: "mouseover" as const,
  crossrefEnabled: true,
  crossrefLiveRendering: true,
  crossrefEnableCiteproc: true,
  mediaThumbnails: true,
  experimentalUnlinkedReferences: true,
  annotationEnabled: true,
  annotationScopeHighlight: true,
  annotationDefaultLang: "en",
  annotationDisplayMode: "pill" as const,
  loaded: true,
};

let invokeCalls: { cmd: string; args: Record<string, unknown> }[];

beforeEach(() => {
  invokeCalls = [];
  mockInvoke((cmd, args) => {
    invokeCalls.push({ cmd, args: args ?? {} });
    return undefined;
  });
  usePreferencesStore.setState(defaults);
});

describe("SettingsModal", () => {
  // --- Existing shell tests ---

  it("renders nothing when open=false", () => {
    const { container } = render(<SettingsModal open={false} onClose={vi.fn()} />);
    expect(container.querySelector("[data-testid='settings-modal-backdrop']")).toBeNull();
  });

  it("renders backdrop and dialog when open", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    expect(container.querySelector("[data-testid='settings-modal-backdrop']")).toBeTruthy();
    expect(container.querySelector("[data-testid='settings-modal-dialog']")).toBeTruthy();
  });

  it("shows title when open", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain("Settings");
  });

  it("Escape key calls onClose", () => {
    const onClose = vi.fn();
    render(<SettingsModal open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not listen for Escape when closed", () => {
    const onClose = vi.fn();
    render(<SettingsModal open={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal open={true} onClose={onClose} />);
    const btn = container.querySelector("[data-testid='settings-modal-close']")!;
    fireEvent.click(btn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // --- Structural tests ---

  it("renders all five section headings", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const headings = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headings).toEqual(["Appearance", "Editor", "Cross-references", "Annotations", "Experimental"]);
  });

  it("has a scrollable content area", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const content = container.querySelector("[data-testid='settings-modal-content']")!;
    expect(content.className).toContain("overflow-y-auto");
  });

  // --- darkMode (SegmentedControl) ---

  describe("darkMode", () => {
    it("reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const autoBtn = container.querySelector("[data-testid='settings-darkMode-auto']")!;
      expect(autoBtn.getAttribute("aria-pressed")).toBe("true");
    });

    it("reflects alternate value", () => {
      usePreferencesStore.setState({ darkMode: "dark" });
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const darkBtn = container.querySelector("[data-testid='settings-darkMode-dark']")!;
      expect(darkBtn.getAttribute("aria-pressed")).toBe("true");
    });

    it("clicking option calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const darkBtn = container.querySelector("[data-testid='settings-darkMode-dark']")!;
      fireEvent.click(darkBtn);
      expect(usePreferencesStore.getState().darkMode).toBe("dark");
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "workbench.darkMode", value: "dark" },
        });
      });
    });
  });

  // --- colorTheme (SettingsTextInput) ---

  describe("colorTheme", () => {
    it("shows empty when store is null", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-colorTheme']") as HTMLInputElement;
      expect(input.value).toBe("");
    });

    it("shows current store value", () => {
      usePreferencesStore.setState({ colorTheme: "dracula" });
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-colorTheme']") as HTMLInputElement;
      expect(input.value).toBe("dracula");
    });

    it("commits on blur via setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-colorTheme']") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "monokai" } });
      fireEvent.blur(input);
      expect(usePreferencesStore.getState().colorTheme).toBe("monokai");
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "workbench.colorTheme", value: "monokai" },
        });
      });
    });

    it("commits null when empty", async () => {
      usePreferencesStore.setState({ colorTheme: "dracula" });
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-colorTheme']") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);
      expect(usePreferencesStore.getState().colorTheme).toBeNull();
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "workbench.colorTheme", value: null },
        });
      });
    });
  });

  // --- sidebarVisible (ToggleSwitch) ---

  describe("sidebarVisible", () => {
    it("reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-sidebarVisible']")!;
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });

    it("clicking toggle calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-sidebarVisible']")!;
      fireEvent.click(toggle);
      expect(usePreferencesStore.getState().sidebarVisible).toBe(false);
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "workbench.sideBar.visible", value: false },
        });
      });
    });
  });

  // --- sidebarLocation (SegmentedControl) ---

  describe("sidebarLocation", () => {
    it("reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const leftBtn = container.querySelector("[data-testid='settings-sidebarLocation-left']")!;
      expect(leftBtn.getAttribute("aria-pressed")).toBe("true");
    });

    it("clicking option calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const rightBtn = container.querySelector("[data-testid='settings-sidebarLocation-right']")!;
      fireEvent.click(rightBtn);
      expect(usePreferencesStore.getState().sidebarLocation).toBe("right");
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "workbench.sideBar.location", value: "right" },
        });
      });
    });
  });

  // --- foldingEnabled (ToggleSwitch) ---

  describe("foldingEnabled", () => {
    it("reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-foldingEnabled']")!;
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });

    it("clicking toggle calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-foldingEnabled']")!;
      fireEvent.click(toggle);
      expect(usePreferencesStore.getState().foldingEnabled).toBe(false);
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "editor.folding.enabled", value: false },
        });
      });
    });
  });

  // --- foldingShowControls (SegmentedControl) ---

  describe("foldingShowControls", () => {
    it("reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const mouseoverBtn = container.querySelector("[data-testid='settings-foldingShowControls-mouseover']")!;
      expect(mouseoverBtn.getAttribute("aria-pressed")).toBe("true");
    });

    it("clicking option calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const alwaysBtn = container.querySelector("[data-testid='settings-foldingShowControls-always']")!;
      fireEvent.click(alwaysBtn);
      expect(usePreferencesStore.getState().foldingShowControls).toBe("always");
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "editor.folding.showFoldingControls", value: "always" },
        });
      });
    });
  });

  // --- mediaThumbnails (ToggleSwitch) ---

  describe("mediaThumbnails", () => {
    it("reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-mediaThumbnails']")!;
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });

    it("clicking toggle calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-mediaThumbnails']")!;
      fireEvent.click(toggle);
      expect(usePreferencesStore.getState().mediaThumbnails).toBe(false);
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "editor.mediaThumbnails", value: false },
        });
      });
    });
  });

  // --- crossrefEnabled (ToggleSwitch) ---

  describe("crossrefEnabled", () => {
    it("reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-crossrefEnabled']")!;
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });

    it("clicking toggle calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-crossrefEnabled']")!;
      fireEvent.click(toggle);
      expect(usePreferencesStore.getState().crossrefEnabled).toBe(false);
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "crossref.enabled", value: false },
        });
      });
    });
  });

  // --- crossrefLiveRendering (ToggleSwitch) ---

  describe("crossrefLiveRendering", () => {
    it("reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-crossrefLiveRendering']")!;
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });

    it("clicking toggle calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-crossrefLiveRendering']")!;
      fireEvent.click(toggle);
      expect(usePreferencesStore.getState().crossrefLiveRendering).toBe(false);
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "crossref.liveRendering", value: false },
        });
      });
    });
  });

  // --- crossrefEnableCiteproc (ToggleSwitch) ---

  describe("crossrefEnableCiteproc", () => {
    it("reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-crossrefEnableCiteproc']")!;
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });

    it("clicking toggle calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-crossrefEnableCiteproc']")!;
      fireEvent.click(toggle);
      expect(usePreferencesStore.getState().crossrefEnableCiteproc).toBe(false);
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "crossref.enableCiteproc", value: false },
        });
      });
    });
  });

  // --- annotationEnabled (ToggleSwitch) ---

  describe("annotationEnabled", () => {
    it("reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-annotationEnabled']")!;
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });

    it("clicking toggle calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-annotationEnabled']")!;
      fireEvent.click(toggle);
      expect(usePreferencesStore.getState().annotationEnabled).toBe(false);
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "annotations.enabled", value: false },
        });
      });
    });
  });

  // --- annotationScopeHighlight (ToggleSwitch) ---

  describe("annotationScopeHighlight", () => {
    it("reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-annotationScopeHighlight']")!;
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });

    it("clicking toggle calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-annotationScopeHighlight']")!;
      fireEvent.click(toggle);
      expect(usePreferencesStore.getState().annotationScopeHighlight).toBe(false);
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "annotations.scopeHighlight", value: false },
        });
      });
    });
  });

  // --- annotationDefaultLang (SettingsTextInput) ---

  describe("annotationDefaultLang", () => {
    it("shows current store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-annotationDefaultLang']") as HTMLInputElement;
      expect(input.value).toBe("en");
    });

    it("commits on blur via setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-annotationDefaultLang']") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "zh" } });
      fireEvent.blur(input);
      expect(usePreferencesStore.getState().annotationDefaultLang).toBe("zh");
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "annotations.defaultLang", value: "zh" },
        });
      });
    });
  });

  // --- annotationDisplayMode (SegmentedControl) ---

  describe("annotationDisplayMode", () => {
    it("reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const pillBtn = container.querySelector("[data-testid='settings-annotationDisplayMode-pill']")!;
      expect(pillBtn.getAttribute("aria-pressed")).toBe("true");
    });

    it("clicking option calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const footnoteBtn = container.querySelector("[data-testid='settings-annotationDisplayMode-footnote']")!;
      fireEvent.click(footnoteBtn);
      expect(usePreferencesStore.getState().annotationDisplayMode).toBe("footnote");
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "annotations.displayMode", value: "footnote" },
        });
      });
    });
  });

  // --- experimentalUnlinkedReferences (ToggleSwitch) ---

  describe("experimentalUnlinkedReferences", () => {
    it("reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-experimentalUnlinkedReferences']")!;
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });

    it("clicking toggle calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const toggle = container.querySelector("[data-testid='settings-experimentalUnlinkedReferences']")!;
      fireEvent.click(toggle);
      expect(usePreferencesStore.getState().experimentalUnlinkedReferences).toBe(false);
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "experimental.unlinkedReferences", value: false },
        });
      });
    });
  });

  // --- Reactivity ---

  it("reflects external store changes", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const toggle = container.querySelector("[data-testid='settings-sidebarVisible']")!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    act(() => {
      usePreferencesStore.setState({ sidebarVisible: false });
    });

    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("syncs colorTheme local state when store changes externally", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const input = container.querySelector("[data-testid='settings-colorTheme']") as HTMLInputElement;
    expect(input.value).toBe("");

    act(() => {
      usePreferencesStore.setState({ colorTheme: "nord" });
    });

    expect(input.value).toBe("nord");
  });
});
