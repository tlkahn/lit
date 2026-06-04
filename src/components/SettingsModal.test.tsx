import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { mockInvoke } from "../test/tauri-mock";
import { usePreferencesStore } from "../stores/preferences";
import { useThemeStore } from "../stores/theme";
import { CATEGORIES, SETTINGS_REGISTRY } from "../lib/settingsRegistry";
import { useSecretStoreStore } from "../stores/secretStore";

const defaults = {
  darkMode: "auto" as const,
  colorTheme: null,
  sidebarVisible: true,
  sidebarLocation: "left" as const,
  bottomPanelPosition: "bottom" as const,
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
  llmModel: "claude-sonnet-4-6",
  llmOpenaiApiKeySet: false,
  llmOpenaiBaseUrl: "",
  llmAnthropicApiKeySet: false,
  llmAnthropicBaseUrl: "",
  llmSystemPrompt: "",
  llmTemperature: 0.7,
  neighborsDepth: 1,
  llmPromptLlm: "Execute the following instruction using the provided context.",
  llmPromptTr: "Translate the following text. If a hint is provided, follow it.",
  llmPromptQ: "Answer the following question about the provided context.",
  academicPandocPath: "",
  academicCrossrefPath: "",
  academicPdfEngine: "",
  academicDefaultCsl: "",
  academicDefaultTemplate: "",
  academicDefaultReferenceDoc: "",
  loaded: true,
};

let invokeCalls: { cmd: string; args: Record<string, unknown> }[];

beforeEach(() => {
  invokeCalls = [];
  mockInvoke((cmd, args) => {
    invokeCalls.push({ cmd, args: args ?? {} });
    if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
    if (cmd === "has_api_key") return false;
    return undefined;
  });
  usePreferencesStore.setState(defaults);
  useSecretStoreStore.getState()._resetSettler();
  useSecretStoreStore.setState({ exists: false, unlocked: false, loading: false, promptOpen: false });
  useThemeStore.setState({
    availableThemes: [
      { name: "Dracula", version: "1.0", author: "Dracula Team", directory_name: "dracula" },
      { name: "Nord", version: "1.0", author: "Arctic Ice Studio", directory_name: "nord" },
    ],
  });
  Element.prototype.scrollIntoView = vi.fn();
});

function mockScrollIntoView() {
  let target: Element | null = null;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    target = this;
  });
  return () => target;
}

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

  // --- Backdrop click ---

  it("clicking backdrop calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal open={true} onClose={onClose} />);
    const backdrop = container.querySelector("[data-testid='settings-modal-backdrop']")!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking dialog does not call onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal open={true} onClose={onClose} />);
    const dialog = container.querySelector("[data-testid='settings-modal-dialog']")!;
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  // --- Structural tests ---

  it("renders all seven section headings", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const headings = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headings).toEqual(["Appearance", "Editor", "Cross-references", "Annotations", "LLM", "Academic Export", "Experimental"]);
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

  // --- colorTheme (SettingsDropdown) ---

  describe("colorTheme", () => {
    it("renders a <select> element", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-colorTheme']");
      expect(select).toBeTruthy();
      expect(select!.tagName).toBe("SELECT");
    });

    it("shows Default + available theme names as options", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-colorTheme']")!;
      const opts = select.querySelectorAll("option");
      expect(opts).toHaveLength(3);
      expect(opts[0]!.value).toBe("");
      expect(opts[0]!.textContent).toBe("Default");
      expect(opts[1]!.value).toBe("dracula");
      expect(opts[1]!.textContent).toBe("Dracula");
      expect(opts[2]!.value).toBe("nord");
      expect(opts[2]!.textContent).toBe("Nord");
    });

    it("null store value selects Default", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-colorTheme']") as HTMLSelectElement;
      expect(select.value).toBe("");
    });

    it("non-null store value selects that theme", () => {
      usePreferencesStore.setState({ colorTheme: "nord" });
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-colorTheme']") as HTMLSelectElement;
      expect(select.value).toBe("nord");
    });

    it("selecting a theme commits immediately via setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-colorTheme']")!;
      fireEvent.change(select, { target: { value: "dracula" } });
      expect(usePreferencesStore.getState().colorTheme).toBe("dracula");
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "workbench.colorTheme", value: "dracula" },
        });
      });
    });

    it("auto-clears stale colorTheme not in availableThemes", async () => {
      usePreferencesStore.setState({ colorTheme: "deleted-theme" });
      render(<SettingsModal open={true} onClose={vi.fn()} />);
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().colorTheme).toBeNull();
      });
      expect(invokeCalls).toContainEqual({
        cmd: "set_preference",
        args: { key: "workbench.colorTheme", value: null },
      });
    });

    it("does not auto-clear valid colorTheme", () => {
      usePreferencesStore.setState({ colorTheme: "dracula" });
      render(<SettingsModal open={true} onClose={vi.fn()} />);
      expect(usePreferencesStore.getState().colorTheme).toBe("dracula");
    });

    it("does not fire IPC when colorTheme is already null", () => {
      render(<SettingsModal open={true} onClose={vi.fn()} />);
      const colorThemeCalls = invokeCalls.filter(
        (c) => c.cmd === "set_preference" && c.args.key === "workbench.colorTheme",
      );
      expect(colorThemeCalls).toHaveLength(0);
    });

    it("dropdown shows Default after stale theme is auto-cleared", async () => {
      usePreferencesStore.setState({ colorTheme: "deleted-theme" });
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().colorTheme).toBeNull();
      });
      const select = container.querySelector("[data-testid='settings-colorTheme']") as HTMLSelectElement;
      expect(select.value).toBe("");
    });

    it("selecting Default commits null", async () => {
      usePreferencesStore.setState({ colorTheme: "dracula" });
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-colorTheme']")!;
      fireEvent.change(select, { target: { value: "" } });
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

  // --- bottomPanelPosition (SegmentedControl) ---

  describe("bottomPanelPosition", () => {
    it("reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const bottomBtn = container.querySelector("[data-testid='settings-bottomPanelPosition-bottom']")!;
      expect(bottomBtn.getAttribute("aria-pressed")).toBe("true");
    });

    it("clicking option calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const sideBtn = container.querySelector("[data-testid='settings-bottomPanelPosition-side']")!;
      fireEvent.click(sideBtn);
      expect(usePreferencesStore.getState().bottomPanelPosition).toBe("side");
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "workbench.bottomPanel.position", value: "side" },
        });
      });
    });

    it("renders both Bottom and Side segmented options", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const bottomBtn = container.querySelector("[data-testid='settings-bottomPanelPosition-bottom']")!;
      const sideBtn = container.querySelector("[data-testid='settings-bottomPanelPosition-side']")!;
      expect(bottomBtn).toBeTruthy();
      expect(sideBtn).toBeTruthy();
      expect(bottomBtn.textContent).toBe("Bottom");
      expect(sideBtn.textContent).toBe("Side");
    });

    it("reflects store value 'side' when preference is pre-set", () => {
      usePreferencesStore.setState({ bottomPanelPosition: "side" });
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const sideBtn = container.querySelector("[data-testid='settings-bottomPanelPosition-side']")!;
      const bottomBtn = container.querySelector("[data-testid='settings-bottomPanelPosition-bottom']")!;
      expect(sideBtn.getAttribute("aria-pressed")).toBe("true");
      expect(bottomBtn.getAttribute("aria-pressed")).toBe("false");
    });

    it("persists value round-trip: click Side, store updates, IPC fires", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      // Initial state
      expect(usePreferencesStore.getState().bottomPanelPosition).toBe("bottom");
      // Click Side
      const sideBtn = container.querySelector("[data-testid='settings-bottomPanelPosition-side']")!;
      fireEvent.click(sideBtn);
      // Store updated
      expect(usePreferencesStore.getState().bottomPanelPosition).toBe("side");
      // IPC called for persistence
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "workbench.bottomPanel.position", value: "side" },
        });
      });
      // UI reflects new selection
      expect(sideBtn.getAttribute("aria-pressed")).toBe("true");
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

    it("trims whitespace-only input to empty string on blur", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-annotationDefaultLang']") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "  " } });
      fireEvent.blur(input);
      expect(usePreferencesStore.getState().annotationDefaultLang).toBe("");
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "annotations.defaultLang", value: "" },
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

  // --- LLM Model (SettingsDropdown) ---

  describe("llmModel", () => {
    it("LLM Model dropdown reflects store value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-llmModel']") as HTMLSelectElement;
      expect(select.value).toBe("claude-sonnet-4-6");
    });

    it("changing model calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-llmModel']")!;
      fireEvent.change(select, { target: { value: "gpt-4o" } });
      expect(usePreferencesStore.getState().llmModel).toBe("gpt-4o");
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "llm.model", value: "gpt-4o" },
        });
      });
    });
  });

  // --- OpenAI API Key (SettingsPasswordInput) ---

  describe("llmOpenaiApiKeySet", () => {
    it("OpenAI API Key renders password input", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-llmOpenaiApiKeySet']");
      expect(input).toBeTruthy();
      expect(input!.getAttribute("type")).toBe("password");
    });

    it("saving key calls set_api_key IPC and updates store", async () => {
      useSecretStoreStore.setState({ unlocked: true });
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<SettingsModal open={true} onClose={vi.fn()} />));
      });
      const input = container.querySelector("[data-testid='settings-llmOpenaiApiKeySet']")!;
      const saveBtn = container.querySelector("[data-testid='settings-llmOpenaiApiKeySet-save']")!;
      await act(async () => {
        fireEvent.change(input, { target: { value: "sk-test" } });
        fireEvent.click(saveBtn);
      });
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({ cmd: "set_api_key", args: { provider: "openai", key: "sk-test" } });
      });
      expect(usePreferencesStore.getState().llmOpenaiApiKeySet).toBe(true);
    });

    it("deleting key calls delete_api_key IPC and updates store", async () => {
      useSecretStoreStore.setState({ unlocked: true });
      mockInvoke((cmd, args) => {
        invokeCalls.push({ cmd, args: args ?? {} });
        if (cmd === "has_api_key") return true;
        if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
        return undefined;
      });
      usePreferencesStore.setState({ llmOpenaiApiKeySet: true });
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<SettingsModal open={true} onClose={vi.fn()} />));
      });
      const clearBtn = container.querySelector("[data-testid='settings-llmOpenaiApiKeySet-clear']")!;
      await act(async () => {
        fireEvent.click(clearBtn);
      });
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({ cmd: "delete_api_key", args: { provider: "openai" } });
      });
      expect(usePreferencesStore.getState().llmOpenaiApiKeySet).toBe(false);
    });
  });

  // --- System Prompt (SettingsTextArea) ---

  describe("llmSystemPrompt", () => {
    it("System Prompt renders textarea", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const ta = container.querySelector("[data-testid='settings-llmSystemPrompt']");
      expect(ta).toBeTruthy();
      expect(ta!.tagName).toBe("TEXTAREA");
    });

    it("commits on blur via setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const ta = container.querySelector("[data-testid='settings-llmSystemPrompt']") as HTMLTextAreaElement;
      fireEvent.change(ta, { target: { value: "You are helpful" } });
      fireEvent.blur(ta);
      expect(usePreferencesStore.getState().llmSystemPrompt).toBe("You are helpful");
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "llm.systemPrompt", value: "You are helpful" },
        });
      });
    });
  });

  // --- Temperature (SettingsSlider) ---

  describe("llmTemperature", () => {
    it("Temperature renders slider", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-llmTemperature']");
      expect(input).toBeTruthy();
      expect(input!.getAttribute("type")).toBe("range");
    });

    it("displays current value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const readout = container.querySelector("[data-testid='settings-llmTemperature-value']");
      expect(readout).toBeTruthy();
      expect(readout!.textContent).toBe("0.7");
    });

    it("changing slider calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-llmTemperature']")!;
      fireEvent.change(input, { target: { value: "1.2" } });
      expect(usePreferencesStore.getState().llmTemperature).toBe(1.2);
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "llm.temperature", value: 1.2 },
        });
      });
    });
  });

  // --- neighborsDepth (SettingsSlider) ---

  describe("neighborsDepth", () => {
    it("renders slider", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-neighborsDepth']");
      expect(input).toBeTruthy();
      expect(input!.getAttribute("type")).toBe("range");
    });

    it("displays current value", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const readout = container.querySelector("[data-testid='settings-neighborsDepth-value']");
      expect(readout).toBeTruthy();
      expect(readout!.textContent).toBe("1");
    });

    it("changing slider calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-neighborsDepth']")!;
      fireEvent.change(input, { target: { value: "2" } });
      expect(usePreferencesStore.getState().neighborsDepth).toBe(2);
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "llm.neighborsDepth", value: 2 },
        });
      });
    });
  });

  // --- LLM search ---

  it("search 'model' includes LLM settings", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "model" } });
    expect(container.querySelector("[data-testid='settings-llmModel']")).toBeTruthy();
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

  // --- IPC error rollback ---

  it("reverts store when setPreference IPC rejects", async () => {
    mockInvoke((cmd) => {
      if (cmd === "set_preference") throw new Error("disk full");
    });
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const toggle = container.querySelector("[data-testid='settings-foldingEnabled']")!;
    expect(usePreferencesStore.getState().foldingEnabled).toBe(true);
    await act(async () => {
      fireEvent.click(toggle);
      expect(usePreferencesStore.getState().foldingEnabled).toBe(false);
    });
    expect(usePreferencesStore.getState().foldingEnabled).toBe(true);
  });

  // --- Focus trap ---

  it("traps focus within the modal", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const dialog = container.querySelector("[data-testid='settings-modal-dialog']")!;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    last.focus();
    expect(document.activeElement).toBe(last);

    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    Object.defineProperty(tabEvent, "preventDefault", { value: () => {} });
    dialog.dispatchEvent(tabEvent);
    expect(document.activeElement).toBe(first);
  });

  it("Tab from last focusable wraps to the search input", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const dialog = container.querySelector("[data-testid='settings-modal-dialog']")!;
    const searchInput = container.querySelector("[data-testid='settings-search']")!;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const last = focusable[focusable.length - 1]!;

    last.focus();
    expect(document.activeElement).toBe(last);

    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    Object.defineProperty(tabEvent, "preventDefault", { value: () => {} });
    dialog.dispatchEvent(tabEvent);
    expect(document.activeElement).toBe(searchInput);
  });

  // --- Category sidebar ---

  it("renders settings-sidebar when open", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    expect(container.querySelector("[data-testid='settings-sidebar']")).toBeTruthy();
  });

  it("sidebar contains buttons matching CATEGORIES", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual([...CATEGORIES]);
  });

  it("clicking Editor updates aria-selected on sidebar buttons", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    const editorBtn = buttons.find((b) => b.textContent === "Editor")!;
    fireEvent.click(editorBtn);
    expect(editorBtn.getAttribute("aria-selected")).toBe("true");
    const appearanceBtn = buttons.find((b) => b.textContent === "Appearance")!;
    expect(appearanceBtn.getAttribute("aria-selected")).toBe("false");
  });

  it("clicking Editor calls scrollIntoView on its section", () => {
    const getScrollTarget = mockScrollIntoView();
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const editorBtn = Array.from(sidebar.querySelectorAll("button")).find((b) => b.textContent === "Editor")!;
    fireEvent.click(editorBtn);
    expect((getScrollTarget() as HTMLElement)?.id).toBe("settings-section-Editor");
  });

  it("first category has aria-selected=true by default", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = sidebar.querySelectorAll("button");
    expect(buttons[0]!.getAttribute("aria-selected")).toBe("true");
    for (let i = 1; i < buttons.length; i++) {
      expect(buttons[i]!.getAttribute("aria-selected")).toBe("false");
    }
  });

  // --- Registry-driven rendering safety net ---

  it("all 30 control data-testid values exist", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const expectedIds = [
      "settings-darkMode-auto",
      "settings-colorTheme",
      "settings-sidebarVisible",
      "settings-sidebarLocation-left",
      "settings-bottomPanelPosition-bottom",
      "settings-foldingEnabled",
      "settings-foldingShowControls-mouseover",
      "settings-mediaThumbnails",
      "settings-crossrefEnabled",
      "settings-crossrefLiveRendering",
      "settings-crossrefEnableCiteproc",
      "settings-annotationEnabled",
      "settings-annotationScopeHighlight",
      "settings-annotationDefaultLang",
      "settings-annotationDisplayMode-pill",
      "settings-llmModel",
      "settings-llmOpenaiApiKeySet",
      "settings-llmOpenaiBaseUrl",
      "settings-llmAnthropicApiKeySet",
      "settings-llmAnthropicBaseUrl",
      "settings-llmSystemPrompt",
      "settings-llmTemperature",
      "settings-neighborsDepth",
      "settings-academicPandocPath",
      "settings-academicCrossrefPath",
      "settings-academicPdfEngine",
      "settings-academicDefaultCsl",
      "settings-academicDefaultTemplate",
      "settings-academicDefaultReferenceDoc",
      "settings-experimentalUnlinkedReferences",
    ];
    for (const id of expectedIds) {
      expect(container.querySelector(`[data-testid='${id}']`), `missing ${id}`).toBeTruthy();
    }
  });

  it("all 7 h3 headings render with correct text", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const headings = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headings).toEqual(["Appearance", "Editor", "Cross-references", "Annotations", "LLM", "Academic Export", "Experimental"]);
  });

  // --- Search input ---

  it("settings-search input exists when modal is open", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const input = container.querySelector("[data-testid='settings-search']");
    expect(input).toBeTruthy();
    expect(input!.tagName).toBe("INPUT");
  });

  it("search input has placeholder 'Search settings…'", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const input = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    expect(input.placeholder).toBe("Search settings…");
  });

  it("search input auto-focuses when modal opens", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const input = container.querySelector("[data-testid='settings-search']")!;
    expect(document.activeElement).toBe(input);
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

  it("syncs colorTheme when store changes externally", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const select = container.querySelector("[data-testid='settings-colorTheme']") as HTMLSelectElement;
    expect(select.value).toBe("");

    act(() => {
      usePreferencesStore.setState({ colorTheme: "nord" });
    });

    expect(select.value).toBe("nord");
  });

  // --- Phase 6: Search Filtering ---

  // Cycle 6.1 — Typing filters settings to matches only

  it("typing 'fold' shows only folding controls", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });

    expect(container.querySelector("[data-testid='settings-foldingEnabled']")).toBeTruthy();
    expect(container.querySelector("[data-testid^='settings-foldingShowControls']")).toBeTruthy();

    expect(container.querySelector("[data-testid^='settings-darkMode']")).toBeNull();
    expect(container.querySelector("[data-testid='settings-sidebarVisible']")).toBeNull();
    expect(container.querySelector("[data-testid='settings-colorTheme']")).toBeNull();
    expect(container.querySelector("[data-testid='settings-mediaThumbnails']")).toBeNull();
    expect(container.querySelector("[data-testid='settings-crossrefEnabled']")).toBeNull();
    expect(container.querySelector("[data-testid='settings-annotationEnabled']")).toBeNull();
    expect(container.querySelector("[data-testid='settings-experimentalUnlinkedReferences']")).toBeNull();
  });

  it("typing 'xyzzy' shows no-results message", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "xyzzy" } });

    expect(container.querySelector("[data-testid='settings-no-results']")).toBeTruthy();
    expect(container.querySelector("[data-testid='settings-no-results']")!.textContent).toContain("No matching settings");
  });

  it("empty search shows all 30 controls", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });
    fireEvent.change(search, { target: { value: "" } });

    const expectedIds = [
      "settings-darkMode-auto",
      "settings-colorTheme",
      "settings-sidebarVisible",
      "settings-sidebarLocation-left",
      "settings-bottomPanelPosition-bottom",
      "settings-foldingEnabled",
      "settings-foldingShowControls-mouseover",
      "settings-mediaThumbnails",
      "settings-crossrefEnabled",
      "settings-crossrefLiveRendering",
      "settings-crossrefEnableCiteproc",
      "settings-annotationEnabled",
      "settings-annotationScopeHighlight",
      "settings-annotationDefaultLang",
      "settings-annotationDisplayMode-pill",
      "settings-llmModel",
      "settings-llmOpenaiApiKeySet",
      "settings-llmOpenaiBaseUrl",
      "settings-llmAnthropicApiKeySet",
      "settings-llmAnthropicBaseUrl",
      "settings-llmSystemPrompt",
      "settings-llmTemperature",
      "settings-neighborsDepth",
      "settings-academicPandocPath",
      "settings-academicCrossrefPath",
      "settings-academicPdfEngine",
      "settings-academicDefaultCsl",
      "settings-academicDefaultTemplate",
      "settings-academicDefaultReferenceDoc",
      "settings-experimentalUnlinkedReferences",
    ];
    for (const id of expectedIds) {
      expect(container.querySelector(`[data-testid='${id}']`), `missing ${id}`).toBeTruthy();
    }
  });

  // Cycle 6.2 — Category headings hide when section is empty

  it("searching 'fold' shows only Editor heading", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });

    const headings = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headings).toEqual(["Editor"]);
  });

  it("searching 'enabled' shows Cross-references and Annotations headings", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "enabled" } });

    const headings = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headings).toEqual(["Cross-references", "Annotations"]);
  });

  it("clearing search restores all 7 headings", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });
    fireEvent.change(search, { target: { value: "" } });

    const headings = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headings).toEqual(["Appearance", "Editor", "Cross-references", "Annotations", "LLM", "Academic Export", "Experimental"]);
  });

  // Cycle 6.3 — Sidebar highlights categories with matches

  it("searching 'fold' marks Editor sidebar button with data-has-matches=true", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });

    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    const editorBtn = buttons.find((b) => b.textContent === "Editor")!;
    const appearanceBtn = buttons.find((b) => b.textContent === "Appearance")!;

    expect(editorBtn.getAttribute("data-has-matches")).toBe("true");
    expect(appearanceBtn.getAttribute("data-has-matches")).toBe("false");
  });

  it("clearing search removes data-has-matches attributes", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });
    fireEvent.change(search, { target: { value: "" } });

    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    for (const btn of buttons) {
      expect(btn.hasAttribute("data-has-matches")).toBe(false);
    }
  });

  // Cycle 6.4 — Sidebar click clears search when category has no matches

  it("clicking non-matching category clears search and scrolls", () => {
    const getScrollTarget = mockScrollIntoView();
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });

    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const appearanceBtn = Array.from(sidebar.querySelectorAll("button")).find((b) => b.textContent === "Appearance")!;
    act(() => {
      fireEvent.click(appearanceBtn);
    });

    expect(search.value).toBe("");

    const expectedIds = [
      "settings-darkMode-auto",
      "settings-colorTheme",
      "settings-sidebarVisible",
      "settings-sidebarLocation-left",
      "settings-bottomPanelPosition-bottom",
      "settings-foldingEnabled",
      "settings-foldingShowControls-mouseover",
      "settings-mediaThumbnails",
      "settings-crossrefEnabled",
      "settings-crossrefLiveRendering",
      "settings-crossrefEnableCiteproc",
      "settings-annotationEnabled",
      "settings-annotationScopeHighlight",
      "settings-annotationDefaultLang",
      "settings-annotationDisplayMode-pill",
      "settings-llmModel",
      "settings-llmOpenaiApiKeySet",
      "settings-llmOpenaiBaseUrl",
      "settings-llmAnthropicApiKeySet",
      "settings-llmAnthropicBaseUrl",
      "settings-llmSystemPrompt",
      "settings-llmTemperature",
      "settings-neighborsDepth",
      "settings-academicPandocPath",
      "settings-academicCrossrefPath",
      "settings-academicPdfEngine",
      "settings-academicDefaultCsl",
      "settings-academicDefaultTemplate",
      "settings-academicDefaultReferenceDoc",
      "settings-experimentalUnlinkedReferences",
    ];
    for (const id of expectedIds) {
      expect(container.querySelector(`[data-testid='${id}']`), `missing ${id}`).toBeTruthy();
    }

    expect((getScrollTarget() as HTMLElement)?.id).toBe("settings-section-Appearance");
  });

  it("clicking matching category while searching preserves search and scrolls", () => {
    const getScrollTarget = mockScrollIntoView();
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });

    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const editorBtn = Array.from(sidebar.querySelectorAll("button")).find((b) => b.textContent === "Editor")!;
    fireEvent.click(editorBtn);

    expect(search.value).toBe("fold");
    expect((getScrollTarget() as HTMLElement)?.id).toBe("settings-section-Editor");

    expect(container.querySelector("[data-testid='settings-foldingEnabled']")).toBeTruthy();
    expect(container.querySelector("[data-testid^='settings-foldingShowControls']")).toBeTruthy();
    expect(container.querySelector("[data-testid^='settings-darkMode']")).toBeNull();
  });

  // --- Phase 7: Highlighted Match Text in Labels ---

  // Cycle 7.1 — Matched characters highlighted during search

  it("searching 'dark' highlights matched characters in Dark Mode label", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "dark" } });

    const darkModeButton = container.querySelector("[data-testid='settings-darkMode-auto']")!;
    const controlRoot = darkModeButton.parentElement!.parentElement!;
    const labelSpan = controlRoot.querySelector("span.text-sm")!;
    const marks = Array.from(labelSpan.querySelectorAll("mark"));
    expect(marks.length).toBeGreaterThan(0);
    const highlightedText = marks.map((m) => m.textContent).join("");
    expect(highlightedText.toLowerCase()).toBe("dark");
  });

  it("no <mark> elements in labels when not searching", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const content = container.querySelector("[data-testid='settings-modal-content']")!;
    const marks = content.querySelectorAll("mark");
    expect(marks.length).toBe(0);
  });

  // --- Phase 8: Keyboard Accessibility ---

  // Cycle 8.1 — Escape in search clears query first

  it("Escape with non-empty search clears query, modal stays open", () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal open={true} onClose={onClose} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });
    expect(search.value).toBe("fold");

    fireEvent.keyDown(search, { key: "Escape" });
    expect(search.value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape with empty search calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal open={true} onClose={onClose} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    expect(search.value).toBe("");

    fireEvent.keyDown(search, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Cycle 8.2 — Cmd/Ctrl+F focuses search input

  it("Cmd+F focuses the search input", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    const closeBtn = container.querySelector("[data-testid='settings-modal-close']") as HTMLElement;
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);

    fireEvent.keyDown(document, { key: "f", metaKey: true });
    expect(document.activeElement).toBe(search);
  });

  it("Ctrl+F focuses the search input", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    const closeBtn = container.querySelector("[data-testid='settings-modal-close']") as HTMLElement;
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);

    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(search);
  });

  // Cycle 8.3 — Arrow keys navigate sidebar

  it("ArrowDown on focused sidebar button selects next category and focuses it", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    buttons[0]!.focus();

    fireEvent.keyDown(sidebar, { key: "ArrowDown" });
    expect(buttons[1]!.getAttribute("aria-selected")).toBe("true");
    expect(buttons[0]!.getAttribute("aria-selected")).toBe("false");
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("ArrowDown from last category wraps to first", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));

    // Select last category first
    const lastBtn = buttons[buttons.length - 1]!;
    fireEvent.click(lastBtn);
    lastBtn.focus();

    fireEvent.keyDown(sidebar, { key: "ArrowDown" });
    expect(buttons[0]!.getAttribute("aria-selected")).toBe("true");
    expect(lastBtn.getAttribute("aria-selected")).toBe("false");
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("ArrowUp from first category wraps to last and focuses it", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    buttons[0]!.focus();

    fireEvent.keyDown(sidebar, { key: "ArrowUp" });
    const last = buttons[buttons.length - 1]!;
    expect(last.getAttribute("aria-selected")).toBe("true");
    expect(buttons[0]!.getAttribute("aria-selected")).toBe("false");
    expect(document.activeElement).toBe(last);
  });

  it("arrow navigation calls scrollIntoView on the target section", () => {
    const getScrollTarget = mockScrollIntoView();
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    buttons[0]!.focus();

    fireEvent.keyDown(sidebar, { key: "ArrowDown" });
    expect((getScrollTarget() as HTMLElement)?.id).toBe("settings-section-Editor");
  });

  it("arrow navigation skips categories with no matches during search", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    // "mode" matches Appearance (Dark Mode) and Annotations (Display Mode) — not adjacent
    fireEvent.change(search, { target: { value: "mode" } });

    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    const appearanceBtn = buttons.find((b) => b.textContent === "Appearance")!;

    fireEvent.click(appearanceBtn);
    appearanceBtn.focus();

    // ArrowDown should skip Editor and Cross-references, land on Annotations
    fireEvent.keyDown(sidebar, { key: "ArrowDown" });
    const annotationsBtn = buttons.find((b) => b.textContent === "Annotations")!;
    expect(annotationsBtn.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(annotationsBtn);
  });

  it("arrow navigation wraps through matching categories during search", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    // "mode" matches Appearance (Dark Mode), Annotations (Display Mode), and LLM (Model)
    fireEvent.change(search, { target: { value: "mode" } });

    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    const llmBtn = buttons.find((b) => b.textContent === "LLM")!;

    // Start at LLM (last matching category before Experimental)
    fireEvent.click(llmBtn);
    llmBtn.focus();

    // ArrowDown should wrap past Experimental to Appearance (first match)
    fireEvent.keyDown(sidebar, { key: "ArrowDown" });
    const appearanceBtn = buttons.find((b) => b.textContent === "Appearance")!;
    expect(appearanceBtn.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(appearanceBtn);
  });

  it("sidebar nav has role=tablist and aria-orientation=vertical", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    expect(sidebar.getAttribute("role")).toBe("tablist");
    expect(sidebar.getAttribute("aria-orientation")).toBe("vertical");
  });

  // --- Cycle 9: "Edit JSON" toggle button ---

  it("renders 'Edit JSON' button with data-testid='settings-edit-json-btn'", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const btn = container.querySelector("[data-testid='settings-edit-json-btn']");
    expect(btn).toBeTruthy();
    expect(btn!.tagName).toBe("BUTTON");
  });

  it("button text is 'Edit JSON' by default", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const btn = container.querySelector("[data-testid='settings-edit-json-btn']")!;
    expect(btn.textContent).toBe("Edit JSON");
  });

  it("form view is visible and JSON editor is absent by default", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    expect(container.querySelector("[data-testid='settings-sidebar']")).toBeTruthy();
    expect(container.querySelector("[data-testid='settings-search']")).toBeTruthy();
    expect(container.querySelector("[data-testid='settings-json-editor']")).toBeNull();
  });

  // --- Cycle 10: Toggle between form and JSON editor views ---

  it("clicking 'Edit JSON' hides form and shows JSON editor", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences_raw") return "{}";
      return undefined;
    });
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const btn = container.querySelector("[data-testid='settings-edit-json-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(container.querySelector("[data-testid='settings-sidebar']")).toBeNull();
    expect(container.querySelector("[data-testid='settings-json-editor']")).toBeTruthy();
  });

  it("button text changes to 'Form View' in JSON mode", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences_raw") return "{}";
      return undefined;
    });
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const btn = container.querySelector("[data-testid='settings-edit-json-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.textContent).toBe("Form View");
  });

  it("clicking 'Form View' switches back to form", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences_raw") return "{}";
      return undefined;
    });
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const btn = container.querySelector("[data-testid='settings-edit-json-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(container.querySelector("[data-testid='settings-sidebar']")).toBeNull();
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(container.querySelector("[data-testid='settings-sidebar']")).toBeTruthy();
    expect(container.querySelector("[data-testid='settings-search']")).toBeTruthy();
    expect(container.querySelector("[data-testid='settings-json-editor']")).toBeNull();
  });

  it("search bar is hidden in JSON mode", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences_raw") return "{}";
      return undefined;
    });
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const btn = container.querySelector("[data-testid='settings-edit-json-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(container.querySelector("[data-testid='settings-search']")).toBeNull();
  });

  // --- Cycle 11: JSON save triggers IPC + error handling ---

  it("saving valid JSON calls set_preferences_raw IPC", async () => {
    const ipcCalls: { cmd: string; args: Record<string, unknown> }[] = [];
    mockInvoke((cmd, args) => {
      ipcCalls.push({ cmd, args: args ?? {} });
      if (cmd === "get_preferences_raw") return '{"foo": 1}';
      return undefined;
    });
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const btn = container.querySelector("[data-testid='settings-edit-json-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    const saveBtn = container.querySelector("[data-testid='settings-json-save']")!;
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    await vi.waitFor(() => {
      expect(ipcCalls).toContainEqual({
        cmd: "set_preferences_raw",
        args: { json: '{"foo": 1}' },
      });
    });
  });

  it("IPC error from set_preferences_raw surfaces in JSON editor error display", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences_raw") return '{"foo": 1}';
      if (cmd === "set_preferences_raw") throw new Error("disk full");
      return undefined;
    });
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const btn = container.querySelector("[data-testid='settings-edit-json-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    const saveBtn = container.querySelector("[data-testid='settings-json-save']")!;
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='settings-json-error']")).toBeTruthy();
    });
  });

  // --- Cycle 12: Form view refreshes after JSON edits ---

  it("switching from JSON back to form reflects changes made in JSON", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences_raw") return '{}';
      if (cmd === "set_preferences_raw") return undefined;
      return undefined;
    });
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const btn = container.querySelector("[data-testid='settings-edit-json-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(container.querySelector("[data-testid='settings-json-editor']")).toBeTruthy();

    act(() => {
      usePreferencesStore.setState({ darkMode: "dark" });
    });

    await act(async () => {
      fireEvent.click(btn);
    });
    expect(container.querySelector("[data-testid='settings-sidebar']")).toBeTruthy();
    const darkBtn = container.querySelector("[data-testid='settings-darkMode-dark']")!;
    expect(darkBtn.getAttribute("aria-pressed")).toBe("true");
  });

  // --- Phase 4: Edge Cases ---

  it("empty theme list shows only Default option", () => {
    useThemeStore.setState({ availableThemes: [] });
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const select = container.querySelector("[data-testid='settings-colorTheme']")!;
    const opts = select.querySelectorAll("option");
    expect(opts).toHaveLength(1);
    expect(opts[0]!.textContent).toBe("Default");
  });

  it("dynamic theme list update reflects in dropdown", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const select = container.querySelector("[data-testid='settings-colorTheme']")!;
    expect(select.querySelectorAll("option")).toHaveLength(3);

    act(() => {
      useThemeStore.setState({
        availableThemes: [
          { name: "Dracula", version: "1.0", author: "Dracula Team", directory_name: "dracula" },
          { name: "Nord", version: "1.0", author: "Arctic Ice Studio", directory_name: "nord" },
          { name: "Solarized", version: "1.0", author: "Ethan Schoonover", directory_name: "solarized" },
        ],
      });
    });

    expect(select.querySelectorAll("option")).toHaveLength(4);
  });

  // --- hasApiKey effect ---

  describe("hasApiKey effect", () => {
    it("checks all password providers on open", async () => {
      const { rerender } = render(<SettingsModal open={false} onClose={vi.fn()} />);
      invokeCalls.length = 0;
      await act(async () => {
        rerender(<SettingsModal open={true} onClose={vi.fn()} />);
      });
      const calls = invokeCalls.filter((c) => c.cmd === "has_api_key");
      expect(calls).toContainEqual({ cmd: "has_api_key", args: { provider: "openai" } });
      expect(calls).toContainEqual({ cmd: "has_api_key", args: { provider: "anthropic" } });
      expect(calls).toHaveLength(2);
    });

    it("updates store when provider reports key exists", async () => {
      mockInvoke((cmd, args) => {
        if (cmd === "has_api_key" && args?.provider === "openai") return true;
        if (cmd === "has_api_key") return false;
        if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
        return undefined;
      });
      await act(async () => {
        render(<SettingsModal open={true} onClose={vi.fn()} />);
      });
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().llmOpenaiApiKeySet).toBe(true);
      });
      expect(usePreferencesStore.getState().llmAnthropicApiKeySet).toBe(false);
    });
  });

  // --- Password save/delete error rollback ---

  it("password save optimistically updates store and rolls back on IPC failure", async () => {
    useSecretStoreStore.setState({ unlocked: true });
    const setApiKeyCalled = vi.fn();
    mockInvoke((cmd) => {
      if (cmd === "set_api_key") { setApiKeyCalled(); throw new Error("keychain locked"); }
      if (cmd === "has_api_key") return false;
      if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
      return undefined;
    });
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const input = container.querySelector("[data-testid='settings-llmOpenaiApiKeySet']")!;
    const saveBtn = container.querySelector("[data-testid='settings-llmOpenaiApiKeySet-save']")!;
    fireEvent.change(input, { target: { value: "sk-test" } });
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    // After ensureUnlocked resolves (async), setApiKey is called and fails,
    // the optimistic update is set then rolled back
    await vi.waitFor(() => {
      expect(setApiKeyCalled).toHaveBeenCalled();
    });
    // After IPC failure, the store rolls back to false
    await vi.waitFor(() => {
      expect(usePreferencesStore.getState().llmOpenaiApiKeySet).toBe(false);
    });
  });

  it("password delete optimistically updates store and rolls back on IPC failure", async () => {
    useSecretStoreStore.setState({ unlocked: true });
    mockInvoke((cmd) => {
      if (cmd === "delete_api_key") throw new Error("keychain locked");
      if (cmd === "has_api_key") return true;
      if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
      return undefined;
    });
    usePreferencesStore.setState({ llmOpenaiApiKeySet: true });
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<SettingsModal open={true} onClose={vi.fn()} />));
    });
    const clearBtn = container.querySelector("[data-testid='settings-llmOpenaiApiKeySet-clear']")!;
    await act(async () => {
      fireEvent.click(clearBtn);
    });
    await vi.waitFor(() => {
      expect(usePreferencesStore.getState().llmOpenaiApiKeySet).toBe(true);
    });
  });

  // --- Textarea whitespace preservation ---

  it("textarea preserves leading/trailing whitespace on commit", async () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const ta = container.querySelector("[data-testid='settings-llmSystemPrompt']") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "\n  Hello World  \n" } });
    fireEvent.blur(ta);
    expect(usePreferencesStore.getState().llmSystemPrompt).toBe("\n  Hello World  \n");
    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        cmd: "set_preference",
        args: { key: "llm.systemPrompt", value: "\n  Hello World  \n" },
      });
    });
  });

  // --- Cycle B1: TestConnectionButton receives correct provider-specific base URL ---

  it("Test Connection uses Anthropic base URL for claude model", async () => {
    usePreferencesStore.setState({
      llmModel: "claude-sonnet-4-6",
      llmAnthropicBaseUrl: "https://anthropic.example.com",
      llmOpenaiBaseUrl: "https://openai.example.com",
    });
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const btn = container.querySelector("[data-testid='test-connection-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        cmd: "llm_test_connection",
        args: { model: "claude-sonnet-4-6", baseUrl: "https://anthropic.example.com" },
      });
    });
  });

  it("Test Connection uses OpenAI base URL for gpt model", async () => {
    usePreferencesStore.setState({
      llmModel: "gpt-4o",
      llmAnthropicBaseUrl: "https://anthropic.example.com",
      llmOpenaiBaseUrl: "https://openai.example.com",
    });
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const btn = container.querySelector("[data-testid='test-connection-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        cmd: "llm_test_connection",
        args: { model: "gpt-4o", baseUrl: "https://openai.example.com" },
      });
    });
  });

  it("Test Connection passes null when provider base URL is empty", async () => {
    usePreferencesStore.setState({
      llmModel: "claude-sonnet-4-6",
      llmAnthropicBaseUrl: "",
      llmOpenaiBaseUrl: "https://openai.example.com",
    });
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const btn = container.querySelector("[data-testid='test-connection-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        cmd: "llm_test_connection",
        args: { model: "claude-sonnet-4-6", baseUrl: null },
      });
    });
  });

  // --- Advanced group (collapsible per-type prompts) ---

  it("prompt entries have group 'Advanced' in registry", () => {
    const promptFields = ["llmPromptLlm", "llmPromptTr", "llmPromptQ"];
    for (const field of promptFields) {
      const entry = SETTINGS_REGISTRY.find(e => e.storeField === field);
      expect(entry).toBeTruthy();
      expect(entry!.group).toBe("Advanced");
    }
  });

  it("LLM category has a collapsed Advanced section", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const advanced = container.querySelector("[data-testid='settings-group-Advanced']");
    expect(advanced).toBeTruthy();
    expect(container.querySelector("[data-testid='settings-llmPromptLlm']")).toBeNull();
  });

  it("clicking Advanced header reveals prompt textareas", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    expect(container.querySelector("[data-testid='settings-llmPromptLlm']")).toBeNull();

    const header = container.querySelector("[data-testid='settings-group-Advanced'] button")!;
    fireEvent.click(header);

    const promptTestIds = [
      "settings-llmPromptLlm",
      "settings-llmPromptTr",
      "settings-llmPromptQ",
    ];
    for (const id of promptTestIds) {
      expect(container.querySelector(`[data-testid='${id}']`), `missing ${id}`).toBeTruthy();
    }
  });

  it("searching 'Translation' shows prompt textarea without expanding Advanced", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "Translation" } });

    expect(container.querySelector("[data-testid='settings-llmPromptTr']")).toBeTruthy();
    expect(container.querySelector("[data-testid='settings-group-Advanced']")).toBeNull();
  });

  it("all 3 prompt textareas appear after expanding Advanced", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const header = container.querySelector("[data-testid='settings-group-Advanced'] button")!;
    fireEvent.click(header);

    const promptTestIds = [
      "settings-llmPromptLlm",
      "settings-llmPromptTr",
      "settings-llmPromptQ",
    ];
    for (const id of promptTestIds) {
      expect(container.querySelector(`[data-testid='${id}']`), `missing ${id}`).toBeTruthy();
    }
  });

  it("re-opening modal resets to form view", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_preferences_raw") return "{}";
      return undefined;
    });
    const { container, rerender } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const btn = container.querySelector("[data-testid='settings-edit-json-btn']")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(container.querySelector("[data-testid='settings-json-editor']")).toBeTruthy();

    rerender(<SettingsModal open={false} onClose={vi.fn()} />);
    rerender(<SettingsModal open={true} onClose={vi.fn()} />);

    expect(container.querySelector("[data-testid='settings-json-editor']")).toBeNull();
    expect(container.querySelector("[data-testid='settings-sidebar']")).toBeTruthy();
  });

  // --- Academic Export settings ---

  describe("Academic Export category", () => {
    it("renders Academic Export section heading", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const headings = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
      expect(headings).toContain("Academic Export");
    });

    it("Academic Export appears before Experimental in headings", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const headings = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
      const academicIdx = headings.indexOf("Academic Export");
      const experimentalIdx = headings.indexOf("Experimental");
      expect(academicIdx).toBeGreaterThan(-1);
      expect(experimentalIdx).toBeGreaterThan(-1);
      expect(academicIdx).toBeLessThan(experimentalIdx);
    });

    it("renders Pandoc Path text input", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-academicPandocPath']");
      expect(input).toBeTruthy();
      expect(input!.tagName).toBe("INPUT");
    });

    it("renders Crossref Filter Path text input", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-academicCrossrefPath']");
      expect(input).toBeTruthy();
      expect(input!.tagName).toBe("INPUT");
    });

    it("renders PDF Engine dropdown", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-academicPdfEngine']");
      expect(select).toBeTruthy();
      expect(select!.tagName).toBe("SELECT");
    });

    it("PDF Engine dropdown has xelatex, lualatex, pdflatex options", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-academicPdfEngine']")!;
      const opts = Array.from(select.querySelectorAll("option")).map((o) => o.value);
      expect(opts).toContain("xelatex");
      expect(opts).toContain("lualatex");
      expect(opts).toContain("pdflatex");
    });

    it("renders Default CSL Style dropdown", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-academicDefaultCsl']");
      expect(select).toBeTruthy();
      expect(select!.tagName).toBe("SELECT");
    });

    it("Default CSL dropdown has expected styles", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-academicDefaultCsl']")!;
      const opts = Array.from(select.querySelectorAll("option")).map((o) => o.value);
      expect(opts).toContain("apa");
      expect(opts).toContain("ieee");
      expect(opts).toContain("chicago-author-date");
    });

    it("renders Default Template text input", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-academicDefaultTemplate']");
      expect(input).toBeTruthy();
      expect(input!.tagName).toBe("INPUT");
    });

    it("renders Default Reference Doc text input", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-academicDefaultReferenceDoc']");
      expect(input).toBeTruthy();
      expect(input!.tagName).toBe("INPUT");
    });

    it("changing PDF Engine calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-academicPdfEngine']")!;
      fireEvent.change(select, { target: { value: "xelatex" } });
      expect(usePreferencesStore.getState().academicPdfEngine).toBe("xelatex");
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "academic.pdfEngine", value: "xelatex" },
        });
      });
    });

    it("Pandoc Path commits on blur", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const input = container.querySelector("[data-testid='settings-academicPandocPath']") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "/opt/pandoc" } });
      fireEvent.blur(input);
      expect(usePreferencesStore.getState().academicPandocPath).toBe("/opt/pandoc");
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "academic.pandocPath", value: "/opt/pandoc" },
        });
      });
    });

    it("Academic Export appears in sidebar", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
      const buttons = Array.from(sidebar.querySelectorAll("button")).map((b) => b.textContent);
      expect(buttons).toContain("Academic Export");
    });
  });

  // --- Secret store integration ---

  describe("secret store integration", () => {
    // Reset secret store state before each test in this block
    beforeEach(() => {

      useSecretStoreStore.getState()._resetSettler();
      useSecretStoreStore.setState({
        exists: false,
        unlocked: false,
        loading: false,
        promptOpen: false,
      });
    });

    it("skips hasApiKey check when store is locked (exists but not unlocked)", async () => {

      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const localCalls: { cmd: string; args: Record<string, unknown> }[] = [];
      mockInvoke((cmd, args) => {
        localCalls.push({ cmd, args: args ?? {} });
        if (cmd === "has_api_key") return false;
        if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
        return undefined;
      });

      await act(async () => {
        render(<SettingsModal open={true} onClose={vi.fn()} />);
      });

      const hasApiKeyCalls = localCalls.filter((c) => c.cmd === "has_api_key");
      expect(hasApiKeyCalls).toHaveLength(0);
    });

    it("calls hasApiKey when store is unlocked", async () => {

      useSecretStoreStore.setState({ exists: true, unlocked: true });

      const localCalls: { cmd: string; args: Record<string, unknown> }[] = [];
      mockInvoke((cmd, args) => {
        localCalls.push({ cmd, args: args ?? {} });
        if (cmd === "has_api_key") return false;
        if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
        return undefined;
      });

      await act(async () => {
        render(<SettingsModal open={true} onClose={vi.fn()} />);
      });

      const hasApiKeyCalls = localCalls.filter((c) => c.cmd === "has_api_key");
      expect(hasApiKeyCalls).toHaveLength(2);
    });

    it("calls hasApiKey when store does not exist yet", async () => {

      useSecretStoreStore.setState({ exists: false, unlocked: false });

      const localCalls: { cmd: string; args: Record<string, unknown> }[] = [];
      mockInvoke((cmd, args) => {
        localCalls.push({ cmd, args: args ?? {} });
        if (cmd === "has_api_key") return false;
        if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
        return undefined;
      });

      await act(async () => {
        render(<SettingsModal open={true} onClose={vi.fn()} />);
      });

      const hasApiKeyCalls = localCalls.filter((c) => c.cmd === "has_api_key");
      expect(hasApiKeyCalls).toHaveLength(2);
    });

    it("Lock button visible when secret store exists", () => {

      useSecretStoreStore.setState({ exists: true, unlocked: true });

      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const lockBtn = container.querySelector("[data-testid='secret-store-lock-btn']");
      expect(lockBtn).toBeTruthy();
    });

    it("Lock button hidden when secret store does not exist", () => {

      useSecretStoreStore.setState({ exists: false, unlocked: false });

      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const lockBtn = container.querySelector("[data-testid='secret-store-lock-btn']");
      expect(lockBtn).toBeNull();
    });

    it("Change Passphrase button visible when secret store exists", () => {

      useSecretStoreStore.setState({ exists: true, unlocked: true });

      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const changeBtn = container.querySelector("[data-testid='secret-store-change-passphrase-btn']");
      expect(changeBtn).toBeTruthy();
    });

    it("Change Passphrase button hidden when secret store does not exist", () => {

      useSecretStoreStore.setState({ exists: false, unlocked: false });

      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const changeBtn = container.querySelector("[data-testid='secret-store-change-passphrase-btn']");
      expect(changeBtn).toBeNull();
    });

    it("Lock button calls lockSecretStore IPC and refreshes state", async () => {

      useSecretStoreStore.setState({ exists: true, unlocked: true });

      const localCalls: { cmd: string; args: Record<string, unknown> }[] = [];
      mockInvoke((cmd, args) => {
        localCalls.push({ cmd, args: args ?? {} });
        if (cmd === "lock_secret_store") return undefined;
        if (cmd === "secret_store_status") return { exists: true, unlocked: false };
        if (cmd === "has_api_key") return false;
        if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
        return undefined;
      });

      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const lockBtn = container.querySelector("[data-testid='secret-store-lock-btn']")!;
      await act(async () => {
        fireEvent.click(lockBtn);
      });

      await vi.waitFor(() => {
        expect(localCalls).toContainEqual({ cmd: "lock_secret_store", args: {} });
      });
    });

    it("password save calls ensureUnlocked before setApiKey", async () => {

      // Store is already unlocked so ensureUnlocked resolves immediately
      useSecretStoreStore.setState({ exists: true, unlocked: true });

      const localCalls: string[] = [];
      mockInvoke((cmd) => {
        localCalls.push(cmd);
        if (cmd === "has_api_key") return false;
        if (cmd === "set_api_key") return undefined;
        if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
        return undefined;
      });

      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<SettingsModal open={true} onClose={vi.fn()} />));
      });
      const input = container.querySelector("[data-testid='settings-llmOpenaiApiKeySet']")!;
      const saveBtn = container.querySelector("[data-testid='settings-llmOpenaiApiKeySet-save']")!;
      await act(async () => {
        fireEvent.change(input, { target: { value: "sk-test" } });
        fireEvent.click(saveBtn);
      });
      await vi.waitFor(() => {
        expect(localCalls).toContain("set_api_key");
      });
      expect(usePreferencesStore.getState().llmOpenaiApiKeySet).toBe(true);
    });

    it("password delete calls ensureUnlocked before deleteApiKey", async () => {
      // Store is already unlocked so ensureUnlocked resolves immediately
      useSecretStoreStore.setState({ exists: true, unlocked: true });

      const localCalls: string[] = [];
      mockInvoke((cmd) => {
        localCalls.push(cmd);
        if (cmd === "has_api_key") return true;
        if (cmd === "delete_api_key") return undefined;
        if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
        return undefined;
      });

      usePreferencesStore.setState({ llmOpenaiApiKeySet: true });
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<SettingsModal open={true} onClose={vi.fn()} />));
      });
      const clearBtn = container.querySelector("[data-testid='settings-llmOpenaiApiKeySet-clear']")!;
      await act(async () => {
        fireEvent.click(clearBtn);
      });
      await vi.waitFor(() => {
        expect(localCalls).toContain("delete_api_key");
      });
      expect(usePreferencesStore.getState().llmOpenaiApiKeySet).toBe(false);
    });

    it("password delete does not call deleteApiKey when store is locked and passphrase is not provided", async () => {
      // Store exists but is locked; ensureUnlocked will open prompt and block
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const localCalls: string[] = [];
      mockInvoke((cmd) => {
        localCalls.push(cmd);
        if (cmd === "has_api_key") return true;
        if (cmd === "delete_api_key") return undefined;
        if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
        return undefined;
      });

      usePreferencesStore.setState({ llmOpenaiApiKeySet: true });
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<SettingsModal open={true} onClose={vi.fn()} />));
      });
      const clearBtn = container.querySelector("[data-testid='settings-llmOpenaiApiKeySet-clear']")!;
      await act(async () => {
        fireEvent.click(clearBtn);
      });

      // ensureUnlocked opens prompt and blocks — delete_api_key should NOT be called
      expect(localCalls).not.toContain("delete_api_key");
      // Store should NOT have been optimistically updated either
      expect(usePreferencesStore.getState().llmOpenaiApiKeySet).toBe(true);
    });

    it("password delete aborts when user cancels passphrase entry", async () => {
      // Store exists but is locked
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const localCalls: string[] = [];
      mockInvoke((cmd) => {
        localCalls.push(cmd);
        if (cmd === "has_api_key") return true;
        if (cmd === "delete_api_key") return undefined;
        if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
        return undefined;
      });

      usePreferencesStore.setState({ llmOpenaiApiKeySet: true });
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<SettingsModal open={true} onClose={vi.fn()} />));
      });
      const clearBtn = container.querySelector("[data-testid='settings-llmOpenaiApiKeySet-clear']")!;
      await act(async () => {
        fireEvent.click(clearBtn);
      });

      // Simulate user cancelling passphrase prompt
      await act(async () => {
        useSecretStoreStore.getState().settleUnlock(false);
      });

      // delete_api_key should NOT have been called
      expect(localCalls).not.toContain("delete_api_key");
      // Store value should remain true (key still saved)
      expect(usePreferencesStore.getState().llmOpenaiApiKeySet).toBe(true);
    });
  });
});
