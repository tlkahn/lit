import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { mockInvoke } from "../test/tauri-mock";
import { usePreferencesStore } from "../stores/preferences";
import { useThemeStore } from "../stores/theme";
import { FORM_CATEGORIES } from "../lib/settingsRegistry";
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
  llmProvider: { providerId: "anthropic", model: "claude-sonnet-4-6", apiKeySet: false },
  llmSystemPrompt: "",
  llmTemperature: 0.7,
  neighborsDepth: 1,
  llmPromptLlm: "Execute the following instruction using the provided context.",
  llmPromptTr: "Translate the following text. If a hint is provided, follow it.",
  llmPromptQ: "Answer the following question about the provided context.",
  academicPandocPath: "",
  academicCrossrefPath: "",
  academicDefaultCsl: "",
  academicDefaultTemplate: "",
  academicDefaultReferenceDoc: "",
  companionSearchPath: ["."],
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
  useThemeStore.setState({
    availableThemes: [
      { name: "Leuvburn", directory_name: "leuvburn", version: "1.0", author: "test" },
      { name: "Nordic", directory_name: "nordic", version: "1.0", author: "test" },
      { name: "Book", directory_name: "book", version: "1.0", author: "test" },
      { name: "Yuppie", directory_name: "yuppie", version: "1.0", author: "test" },
    ],
  });
  useSecretStoreStore.getState()._resetSettler();
  useSecretStoreStore.setState({ exists: false, unlocked: false, loading: false, migrationPromptOpen: false });
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
  // --- Shell ---

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

  it("renders only the Appearance section heading", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const headings = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headings).toEqual(["Appearance"]);
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

  // --- colorTheme (SettingsDropdown, nullable, dynamic options) ---

  describe("colorTheme", () => {
    it("renders a dropdown with data-testid 'settings-colorTheme'", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-colorTheme']");
      expect(select).toBeTruthy();
      expect(select!.tagName).toBe("SELECT");
    });

    it("has a Default option plus 4 theme options", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-colorTheme']")!;
      const opts = Array.from(select.querySelectorAll("option"));
      expect(opts).toHaveLength(5);
      expect(opts[0]!.textContent).toBe("Default");
      expect(opts[0]!.value).toBe("");
    });

    it("reflects null store value as Default selected", () => {
      usePreferencesStore.setState({ colorTheme: null });
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-colorTheme']") as HTMLSelectElement;
      expect(select.value).toBe("");
    });

    it("reflects a theme store value", () => {
      usePreferencesStore.setState({ colorTheme: "book" });
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-colorTheme']") as HTMLSelectElement;
      expect(select.value).toBe("book");
    });

    it("selecting a theme calls setPreference", async () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-colorTheme']")!;
      fireEvent.change(select, { target: { value: "nordic" } });
      expect(usePreferencesStore.getState().colorTheme).toBe("nordic");
      await vi.waitFor(() => {
        expect(invokeCalls).toContainEqual({
          cmd: "set_preference",
          args: { key: "workbench.colorTheme", value: "nordic" },
        });
      });
    });

    it("selecting Default sends null to setPreference", async () => {
      usePreferencesStore.setState({ colorTheme: "book" });
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

    it("syncs colorTheme when store changes externally", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-colorTheme']") as HTMLSelectElement;
      expect(select.value).toBe("");

      act(() => {
        usePreferencesStore.setState({ colorTheme: "yuppie" });
      });

      expect(select.value).toBe("yuppie");
    });

    it("handles empty theme list", () => {
      useThemeStore.setState({ availableThemes: [] });
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      const select = container.querySelector("[data-testid='settings-colorTheme']")!;
      const opts = Array.from(select.querySelectorAll("option"));
      expect(opts).toHaveLength(1);
      expect(opts[0]!.textContent).toBe("Default");
    });

    it("updates options when dynamic theme list changes", () => {
      const { container, rerender } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      let opts = Array.from(container.querySelector("[data-testid='settings-colorTheme']")!.querySelectorAll("option"));
      expect(opts).toHaveLength(5);

      act(() => {
        useThemeStore.setState({
          availableThemes: [
            { name: "Book", directory_name: "book", version: "1.0", author: "test" },
            { name: "Nordic", directory_name: "nordic", version: "1.0", author: "test" },
          ],
        });
      });
      rerender(<SettingsModal open={true} onClose={vi.fn()} />);
      opts = Array.from(container.querySelector("[data-testid='settings-colorTheme']")!.querySelectorAll("option"));
      expect(opts).toHaveLength(3);
    });
  });

  // --- Fonts (FontSettings under Appearance) ---

  describe("Fonts", () => {
    it("renders FontSettings with manage buttons and size slider", () => {
      const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
      expect(container.querySelector("[data-testid='font-settings']")).toBeTruthy();
      expect(container.querySelector("[data-testid='font-manage-interface']")).toBeTruthy();
      expect(container.querySelector("[data-testid='font-manage-text']")).toBeTruthy();
      expect(container.querySelector("[data-testid='font-manage-monospace']")).toBeTruthy();
      expect(container.querySelector("[data-testid='font-size-slider']")).toBeTruthy();
    });
  });

  // --- Hidden controls stay hidden ---

  it("does not render hidden preference controls", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const hiddenIds = [
      "settings-sidebarVisible",
      "settings-sidebarLocation-left",
      "settings-defaultViewMode-editor",
      "settings-graphViewEnabled",
      "settings-autoRevealInSidebar",
      "settings-bottomPanelPosition-bottom",
      "settings-foldingEnabled",
      "settings-foldingShowControls-mouseover",
      "settings-mediaThumbnails",
      "settings-companionSearchPath",
      "settings-citationNotesDir",
      "settings-defaultImageDir",
      "settings-crossrefEnabled",
      "settings-crossrefLiveRendering",
      "settings-crossrefEnableCiteproc",
      "settings-annotationEnabled",
      "settings-annotationScopeHighlight",
      "settings-annotationDefaultLang",
      "settings-annotationDisplayMode-pill",
      "settings-annotationPrefillLastUsed",
      "settings-llmSystemPrompt",
      "settings-llmTemperature",
      "settings-neighborsDepth",
      "settings-llmPromptLlm",
      "settings-academicPandocPath",
      "settings-academicCrossrefPath",
      "settings-academicDefaultCsl",
      "settings-academicDefaultTemplate",
      "settings-academicDefaultReferenceDoc",
      "settings-academicIndicFont",
      "settings-searchProviders",
      "settings-searchCrossrefEmail",
      "settings-searchUnpaywallEmail",
      "settings-searchS2ApiKey",
      "settings-searchCoreApiKey",
      "settings-searchPubmedApiKey",
      "settings-searchGoogleBooksApiKey",
      "settings-searchBaseApiKey",
      "settings-searchProviderTimeout",
      "settings-experimentalUnlinkedReferences",
      "llm-provider-settings",
      "search-provider-settings",
      "companion-search-path-settings",
    ];
    for (const id of hiddenIds) {
      expect(container.querySelector(`[data-testid='${id}']`), `unexpected ${id}`).toBeNull();
    }
  });

  // --- IPC error rollback ---

  it("reverts store when setPreference IPC rejects", async () => {
    mockInvoke((cmd) => {
      if (cmd === "set_preference") throw new Error("disk full");
    });
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const darkBtn = container.querySelector("[data-testid='settings-darkMode-dark']")!;
    expect(usePreferencesStore.getState().darkMode).toBe("auto");
    await act(async () => {
      fireEvent.click(darkBtn);
      expect(usePreferencesStore.getState().darkMode).toBe("dark");
    });
    await vi.waitFor(() => {
      expect(usePreferencesStore.getState().darkMode).toBe("auto");
    });
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

  it("sidebar contains buttons matching FORM_CATEGORIES", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual([...FORM_CATEGORIES]);
  });

  it("clicking Keyboard Shortcuts updates aria-selected on sidebar buttons", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    const shortcutsBtn = buttons.find((b) => b.textContent === "Keyboard Shortcuts")!;
    fireEvent.click(shortcutsBtn);
    expect(shortcutsBtn.getAttribute("aria-selected")).toBe("true");
    const appearanceBtn = buttons.find((b) => b.textContent === "Appearance")!;
    expect(appearanceBtn.getAttribute("aria-selected")).toBe("false");
  });

  it("clicking a category scrolls to its section", () => {
    const getScrollTarget = mockScrollIntoView();
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const appearanceBtn = Array.from(sidebar.querySelectorAll("button")).find((b) => b.textContent === "Appearance")!;
    fireEvent.click(appearanceBtn);
    expect((getScrollTarget() as HTMLElement)?.id).toBe("settings-section-Appearance");
  });

  it("clicking Keyboard Shortcuts does not scroll (panel replaces sections)", () => {
    const getScrollTarget = mockScrollIntoView();
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const shortcutsBtn = Array.from(sidebar.querySelectorAll("button")).find((b) => b.textContent === "Keyboard Shortcuts")!;
    fireEvent.click(shortcutsBtn);
    expect(getScrollTarget()).toBeNull();
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

  it("renders the three form controls (Dark Mode, Color Theme, Fonts)", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const expectedIds = [
      "settings-darkMode-auto",
      "settings-colorTheme",
      "font-settings",
    ];
    for (const id of expectedIds) {
      expect(container.querySelector(`[data-testid='${id}']`), `missing ${id}`).toBeTruthy();
    }
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
    const autoBtn = container.querySelector("[data-testid='settings-darkMode-auto']")!;
    expect(autoBtn.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      usePreferencesStore.setState({ darkMode: "dark" });
    });

    const darkBtn = container.querySelector("[data-testid='settings-darkMode-dark']")!;
    expect(darkBtn.getAttribute("aria-pressed")).toBe("true");
  });

  // --- Search Filtering ---

  it("searching 'dark' filters to Dark Mode only", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "dark" } });

    expect(container.querySelector("[data-testid='settings-darkMode-auto']")).toBeTruthy();
    expect(container.querySelector("[data-testid='settings-colorTheme']")).toBeNull();
  });

  it("searching 'theme' keeps Color Theme", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "theme" } });

    expect(container.querySelector("[data-testid='settings-colorTheme']")).toBeTruthy();
    expect(container.querySelector("[data-testid='settings-darkMode-auto']")).toBeNull();
  });

  it("typing 'fold' shows no form results (hidden knobs stay hidden)", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });

    expect(container.querySelector("[data-testid='settings-no-results']")).toBeTruthy();
    expect(container.querySelector("[data-testid^='settings-darkMode']")).toBeNull();
    expect(container.querySelector("[data-testid='settings-colorTheme']")).toBeNull();
  });

  it("typing 'openai' shows no form results", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "openai" } });

    expect(container.querySelector("[data-testid='settings-no-results']")).toBeTruthy();
    expect(container.querySelector("[data-testid='llm-provider-settings']")).toBeNull();
  });

  it("typing 'xyzzy' shows no-results message", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "xyzzy" } });

    expect(container.querySelector("[data-testid='settings-no-results']")).toBeTruthy();
    expect(container.querySelector("[data-testid='settings-no-results']")!.textContent).toContain("No matching settings");
  });

  it("clearing search restores all form controls", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });
    fireEvent.change(search, { target: { value: "" } });

    expect(container.querySelector("[data-testid='settings-darkMode-auto']")).toBeTruthy();
    expect(container.querySelector("[data-testid='settings-colorTheme']")).toBeTruthy();
    expect(container.querySelector("[data-testid='font-settings']")).toBeTruthy();
  });

  it("clearing search restores the Appearance heading", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });
    fireEvent.change(search, { target: { value: "" } });

    const headings = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headings).toEqual(["Appearance"]);
  });

  // --- Sidebar match dimming ---

  it("searching 'dark' marks Appearance with data-has-matches=true", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "dark" } });

    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    const appearanceBtn = buttons.find((b) => b.textContent === "Appearance")!;
    const shortcutsBtn = buttons.find((b) => b.textContent === "Keyboard Shortcuts")!;

    expect(appearanceBtn.getAttribute("data-has-matches")).toBe("true");
    // Keyboard Shortcuts is a documentation panel and stays match-neutral
    expect(shortcutsBtn.hasAttribute("data-has-matches")).toBe(false);
  });

  it("searching 'fold' marks Appearance with data-has-matches=false", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });

    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const appearanceBtn = Array.from(sidebar.querySelectorAll("button")).find((b) => b.textContent === "Appearance")!;
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

  // --- Sidebar click vs search ---

  it("clicking a non-matching category clears search and scrolls", () => {
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
    expect(container.querySelector("[data-testid='settings-darkMode-auto']")).toBeTruthy();
    expect((getScrollTarget() as HTMLElement)?.id).toBe("settings-section-Appearance");
  });

  it("clicking a matching category while searching preserves search and scrolls", () => {
    const getScrollTarget = mockScrollIntoView();
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "dark" } });

    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const appearanceBtn = Array.from(sidebar.querySelectorAll("button")).find((b) => b.textContent === "Appearance")!;
    fireEvent.click(appearanceBtn);

    expect(search.value).toBe("dark");
    expect((getScrollTarget() as HTMLElement)?.id).toBe("settings-section-Appearance");
  });

  it("clicking Keyboard Shortcuts while searching preserves search", async () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "dark" } });

    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const shortcutsBtn = Array.from(sidebar.querySelectorAll("button")).find((b) => b.textContent === "Keyboard Shortcuts")!;
    await act(async () => {
      fireEvent.click(shortcutsBtn);
    });

    expect(search.value).toBe("dark");
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='keyboard-shortcuts-panel']")).toBeTruthy();
    });
  });

  // --- Highlighted Match Text in Labels ---

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

  // --- Keyboard Accessibility ---

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

  it("arrow navigation to Keyboard Shortcuts does not scroll (panel replaces sections)", () => {
    const getScrollTarget = mockScrollIntoView();
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    // Appearance -> Keyboard Shortcuts (panel, no scroll)
    buttons[0]!.focus();
    fireEvent.keyDown(sidebar, { key: "ArrowDown" });
    expect(getScrollTarget()).toBeNull();
    // Keyboard Shortcuts -> Appearance: the section is not mounted while the
    // panel is shown, so navigating back cannot scroll either
    fireEvent.keyDown(sidebar, { key: "ArrowDown" });
    expect(getScrollTarget()).toBeNull();
  });

  it("arrow navigation reaches Keyboard Shortcuts during a non-matching search", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fold" } });

    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    buttons[0]!.focus();

    fireEvent.keyDown(sidebar, { key: "ArrowDown" });
    const shortcutsBtn = buttons.find((b) => b.textContent === "Keyboard Shortcuts")!;
    expect(shortcutsBtn.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(shortcutsBtn);
  });

  it("arrow navigation wraps through matching categories during search", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "dark" } });

    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    const shortcutsBtn = buttons.find((b) => b.textContent === "Keyboard Shortcuts")!;

    // Start at Keyboard Shortcuts (last category)
    fireEvent.click(shortcutsBtn);
    shortcutsBtn.focus();

    // ArrowDown wraps to Appearance (first category, has matches)
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

  // --- Keyboard Shortcuts panel ---

  it("Keyboard Shortcuts tab shows the KeyboardShortcutsPanel", async () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const shortcutsBtn = Array.from(sidebar.querySelectorAll("button")).find((b) => b.textContent === "Keyboard Shortcuts")!;
    await act(async () => {
      fireEvent.click(shortcutsBtn);
    });
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='keyboard-shortcuts-panel']")).toBeTruthy();
    });
  });

  it("Keyboard Shortcuts tab hides the search bar", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const shortcutsBtn = Array.from(sidebar.querySelectorAll("button")).find((b) => b.textContent === "Keyboard Shortcuts")!;
    fireEvent.click(shortcutsBtn);
    expect(container.querySelector("[data-testid='settings-search']")).toBeNull();
  });

  // --- initialCategory ---

  it("opens on Keyboard Shortcuts when initialCategory is set", async () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} initialCategory="Keyboard Shortcuts" />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const shortcutsBtn = Array.from(sidebar.querySelectorAll("button")).find((b) => b.textContent === "Keyboard Shortcuts")!;
    expect(shortcutsBtn.getAttribute("aria-selected")).toBe("true");
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='keyboard-shortcuts-panel']")).toBeTruthy();
    });
  });

  it("clamps a non-form initialCategory to Appearance", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} initialCategory="LLM" />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar.querySelectorAll("button"));
    expect(buttons[0]!.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("[data-testid='settings-darkMode-auto']")).toBeTruthy();
  });

  // --- Edit JSON toggle button ---

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

  // --- Toggle between form and JSON editor views ---

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

  // --- JSON save triggers IPC + error handling ---

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

  // --- Form view refreshes after JSON edits ---

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

  // --- Reopen resets state ---

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

  it("re-opening modal resets the search query", () => {
    const { container, rerender } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const search = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "dark" } });
    expect(search.value).toBe("dark");

    rerender(<SettingsModal open={false} onClose={vi.fn()} />);
    rerender(<SettingsModal open={true} onClose={vi.fn()} />);

    const search2 = container.querySelector("[data-testid='settings-search']") as HTMLInputElement;
    expect(search2.value).toBe("");
  });

  it("re-opening modal resets the active category to Appearance", () => {
    const { container, rerender } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    const sidebar = container.querySelector("[data-testid='settings-sidebar']")!;
    const shortcutsBtn = Array.from(sidebar.querySelectorAll("button")).find((b) => b.textContent === "Keyboard Shortcuts")!;
    fireEvent.click(shortcutsBtn);
    expect(shortcutsBtn.getAttribute("aria-selected")).toBe("true");

    rerender(<SettingsModal open={false} onClose={vi.fn()} />);
    rerender(<SettingsModal open={true} onClose={vi.fn()} />);

    const sidebar2 = container.querySelector("[data-testid='settings-sidebar']")!;
    const buttons = Array.from(sidebar2.querySelectorAll("button"));
    expect(buttons[0]!.getAttribute("aria-selected")).toBe("true");
  });

  // --- hasApiKey effect ---

  describe("hasApiKey effect", () => {
    it("checks current provider on open", async () => {
      const { rerender } = render(<SettingsModal open={false} onClose={vi.fn()} />);
      invokeCalls.length = 0;
      await act(async () => {
        rerender(<SettingsModal open={true} onClose={vi.fn()} />);
      });
      const calls = invokeCalls.filter((c) => c.cmd === "has_api_key");
      expect(calls).toContainEqual({ cmd: "has_api_key", args: { provider: "anthropic" } });
      expect(calls).toHaveLength(6);
    });

    it("updates llmProvider.apiKeySet when provider reports key exists", async () => {
      mockInvoke((cmd, args) => {
        if (cmd === "has_api_key" && args?.provider === "anthropic") return true;
        if (cmd === "has_api_key") return false;
        if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
        return undefined;
      });
      await act(async () => {
        render(<SettingsModal open={true} onClose={vi.fn()} />);
      });
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().llmProvider.apiKeySet).toBe(true);
      });
    });

    it("does not apply stale apiKeySet when provider switches before hasApiKey resolves", async () => {
      let resolveHas!: (value: boolean) => void;
      const hasPromise = new Promise<boolean>((r) => {
        resolveHas = r;
      });
      mockInvoke((cmd, args) => {
        invokeCalls.push({ cmd, args: args ?? {} });
        if (cmd === "has_api_key" && args?.provider === "anthropic") return hasPromise;
        if (cmd === "has_api_key") return false;
        if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
        return undefined;
      });
      usePreferencesStore.setState({
        llmProvider: { providerId: "anthropic", model: "claude-sonnet-4-6", apiKeySet: false },
      });
      // exists=false / unlocked=false is the default-fresh path so the effect runs.
      await act(async () => {
        render(<SettingsModal open={true} onClose={vi.fn()} />);
      });
      // Effect fired has_api_key("anthropic") but it has NOT resolved yet.
      // User switches providers in the meantime.
      await act(async () => {
        usePreferencesStore.setState({
          llmProvider: { providerId: "openai", model: "gpt-4o", apiKeySet: false },
        });
      });
      // Now the stale anthropic check resolves with `true`.
      await act(async () => {
        resolveHas(true);
        await hasPromise;
      });
      // The stale anthropic value must NOT clobber the openai provider.
      expect(usePreferencesStore.getState().llmProvider.providerId).toBe("openai");
      expect(usePreferencesStore.getState().llmProvider.apiKeySet).toBe(false);
    });
  });

  // --- Secret store integration (hasApiKey gating only) ---

  describe("secret store integration", () => {
    beforeEach(() => {
      useSecretStoreStore.getState()._resetSettler();
      useSecretStoreStore.setState({
        exists: false,
        unlocked: false,
        loading: false,
        migrationPromptOpen: false,
      });
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
      expect(hasApiKeyCalls).toHaveLength(6);
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
      expect(hasApiKeyCalls).toHaveLength(6);
    });

    it("does not check hasApiKey when store exists but is locked (migration pending)", async () => {
      useSecretStoreStore.setState({ exists: true, unlocked: false });
      usePreferencesStore.setState({ llmProvider: { providerId: "anthropic", model: "claude-sonnet-4-6", apiKeySet: true } });

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
      expect(usePreferencesStore.getState().llmProvider.apiKeySet).toBe(true);
    });

    it("re-checks hasApiKey after store becomes unlocked", async () => {
      useSecretStoreStore.setState({ exists: true, unlocked: false });

      const localCalls: { cmd: string; args: Record<string, unknown> }[] = [];
      mockInvoke((cmd, args) => {
        localCalls.push({ cmd, args: args ?? {} });
        if (cmd === "has_api_key" && args?.provider === "anthropic") return true;
        if (cmd === "has_api_key") return false;
        if (cmd === "get_keymaps" || cmd === "get_menu_shortcuts") return [];
        return undefined;
      });

      let rerender!: ReturnType<typeof render>["rerender"];
      await act(async () => {
        ({ rerender } = render(<SettingsModal open={true} onClose={vi.fn()} />));
      });

      expect(localCalls.filter((c) => c.cmd === "has_api_key")).toHaveLength(0);

      await act(async () => {
        useSecretStoreStore.setState({ unlocked: true });
        rerender(<SettingsModal open={true} onClose={vi.fn()} />);
      });

      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().llmProvider.apiKeySet).toBe(true);
      });
    });
  });
});
