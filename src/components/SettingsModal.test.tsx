import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { mockInvoke } from "../test/tauri-mock";
import { usePreferencesStore } from "../stores/preferences";
import { CATEGORIES } from "../lib/settingsRegistry";

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

  it("all 15 control data-testid values exist", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const expectedIds = [
      "settings-darkMode-auto",
      "settings-colorTheme",
      "settings-sidebarVisible",
      "settings-sidebarLocation-left",
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
      "settings-experimentalUnlinkedReferences",
    ];
    for (const id of expectedIds) {
      expect(container.querySelector(`[data-testid='${id}']`), `missing ${id}`).toBeTruthy();
    }
  });

  it("all 5 h3 headings render with correct text", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const headings = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headings).toEqual(["Appearance", "Editor", "Cross-references", "Annotations", "Experimental"]);
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

  it("syncs colorTheme local state when store changes externally", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const input = container.querySelector("[data-testid='settings-colorTheme']") as HTMLInputElement;
    expect(input.value).toBe("");

    act(() => {
      usePreferencesStore.setState({ colorTheme: "nord" });
    });

    expect(input.value).toBe("nord");
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

  it("empty search shows all 15 controls", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });
    fireEvent.change(search, { target: { value: "" } });

    const expectedIds = [
      "settings-darkMode-auto",
      "settings-colorTheme",
      "settings-sidebarVisible",
      "settings-sidebarLocation-left",
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

  it("clearing search restores all 5 headings", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });
    fireEvent.change(search, { target: { value: "" } });

    const headings = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headings).toEqual(["Appearance", "Editor", "Cross-references", "Annotations", "Experimental"]);
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
    // "mode" matches Appearance (Dark Mode) and Annotations (Display Mode)
    fireEvent.change(search, { target: { value: "mode" } });

    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    const annotationsBtn = buttons.find((b) => b.textContent === "Annotations")!;

    // Start at Annotations (last matching category)
    fireEvent.click(annotationsBtn);
    annotationsBtn.focus();

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
});
