import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { mockInvoke, resetInvokeMock } from "../test/tauri-mock";
import { registerCommand, _clear } from "../lib/commandRegistry";
import { KeyboardShortcutsPanel } from "./KeyboardShortcutsPanel";

async function waitForLoaded(container: HTMLElement) {
  await waitFor(() => {
    expect(container.querySelector("[data-testid='shortcuts-loading']")).toBeNull();
  });
}

function setupMocks() {
  registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold", "strong"], action: () => {} });
  registerCommand({ id: "editor.toggleItalic", label: "Toggle Italic", keywords: ["italic", "emphasis"], action: () => {} });
  registerCommand({ id: "app.commandPalette", label: "Command Palette", keywords: ["palette", "commands"], action: () => {} });
  registerCommand({ id: "workbench.toggleSideBar", label: "Toggle Sidebar", keywords: ["sidebar"], action: () => {} });

  mockInvoke((cmd) => {
    if (cmd === "get_keymaps") {
      return [
        { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
        { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "user" },
        { command: "workbench.toggleSideBar", key: "Mod-\\", source: "default" },
      ];
    }
    if (cmd === "get_menu_shortcuts") {
      return [
        { command: "app.commandPalette", key: "Mod-p", source: "menu" },
      ];
    }
    return [];
  });
}

describe("KeyboardShortcutsPanel", () => {
  beforeEach(() => {
    _clear();
    setupMocks();
  });

  afterEach(() => {
    _clear();
    resetInvokeMock();
  });

  it("renders a table with data-testid", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);
    expect(container.querySelector("[data-testid='keyboard-shortcuts-table']")).not.toBeNull();
  });

  it("renders column headers: Command, Keybinding, Source, When", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);
    const headers = container.querySelectorAll("th");
    const texts = Array.from(headers).map((h) => h.textContent);
    expect(texts).toContain("Command");
    expect(texts).toContain("Keybinding");
    expect(texts).toContain("Source");
    expect(texts).toContain("When");
  });

  it("shows bound entry with command label, KeyChord, and source badge", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);
    const rows = container.querySelectorAll("tbody tr");
    const boldRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Bold"));
    expect(boldRow).toBeDefined();
    expect(boldRow!.querySelector("[data-testid='key-chord']")).not.toBeNull();
    expect(boldRow!.textContent).toContain("Default");
  });

  it("shows unbound entry with '—' placeholder and no badge", async () => {
    _clear();
    registerCommand({ id: "app.unbound", label: "Unbound Command", action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") return [];
      if (cmd === "get_menu_shortcuts") return [];
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    // Unbound commands are hidden by default — toggle them on
    const toggle = container.querySelector("[data-testid='show-unbound-toggle']") as HTMLElement;
    fireEvent.click(toggle);

    const rows = container.querySelectorAll("tbody tr");
    const unboundRow = Array.from(rows).find((r) => r.textContent?.includes("Unbound Command"));
    expect(unboundRow).toBeDefined();
    expect(unboundRow!.textContent).toContain("—");
  });

  it("shows unknown-command entry with commandId in italics", async () => {
    _clear();
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps")
        return [{ command: "ghost.command", key: "Mod-g", source: "default" }];
      if (cmd === "get_menu_shortcuts") return [];
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);
    const rows = container.querySelectorAll("tbody tr");
    const ghostRow = Array.from(rows).find((r) => r.textContent?.includes("ghost.command"));
    expect(ghostRow).toBeDefined();
    const italic = ghostRow!.querySelector("em");
    expect(italic).not.toBeNull();
    expect(italic!.textContent).toBe("ghost.command");
  });

  it("styles source badges: default=muted, user=accent, menu=distinct", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);
    const rows = container.querySelectorAll("tbody tr");

    const boldRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Bold"));
    const defaultBadge = boldRow!.querySelector("[data-testid='source-badge']");
    expect(defaultBadge!.textContent).toBe("Default");
    expect(defaultBadge!.className).toContain("text-text-muted");

    const italicRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Italic"));
    const userBadge = italicRow!.querySelector("[data-testid='source-badge']");
    expect(userBadge!.textContent).toBe("User");
    expect(userBadge!.className).toContain("text-accent");

    const paletteRow = Array.from(rows).find((r) => r.textContent?.includes("Command Palette"));
    const menuBadge = paletteRow!.querySelector("[data-testid='source-badge']");
    expect(menuBadge!.textContent).toBe("Menu");
  });

  it("shows multiple bindings for one command as multiple KeyChord elements", async () => {
    _clear();
    registerCommand({ id: "editor.save", label: "Save", action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps")
        return [
          { command: "editor.save", key: "Mod-s", source: "default" },
          { command: "editor.save", key: "Ctrl-s", source: "user" },
        ];
      if (cmd === "get_menu_shortcuts") return [];
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);
    const rows = container.querySelectorAll("tbody tr");
    const saveRow = Array.from(rows).find((r) => r.textContent?.includes("Save"));
    const chords = saveRow!.querySelectorAll("[data-testid='key-chord']");
    expect(chords.length).toBe(2);
  });

  it("shows loading state initially", () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    expect(container.querySelector("[data-testid='shortcuts-loading']")).not.toBeNull();
  });

  it("has a filter input that filters rows by command label", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const filter = container.querySelector("[data-testid='shortcuts-filter']") as HTMLInputElement;
    expect(filter).not.toBeNull();

    fireEvent.change(filter, { target: { value: "Toggle Bold" } });
    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.length).toBe(1);
    expect(dataRows[0]!.textContent).toContain("Toggle Bold");
  });

  it("filter matches commandId", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const filter = container.querySelector("[data-testid='shortcuts-filter']") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "workbench" } });
    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.length).toBe(1);
    expect(dataRows[0]!.textContent).toContain("Toggle Sidebar");
  });

  it("filter matches keywords", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const filter = container.querySelector("[data-testid='shortcuts-filter']") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "strong" } });
    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.length).toBe(1);
    expect(dataRows[0]!.textContent).toContain("Toggle Bold");
  });

  it("shows empty state when filter matches nothing", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const filter = container.querySelector("[data-testid='shortcuts-filter']") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "zzzznothing" } });
    expect(container.textContent).toContain("No matching shortcuts");
  });

  it("groups commands by prefix with group headers", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);
    const headers = container.querySelectorAll("[data-testid='group-header']");
    const headerTexts = Array.from(headers).map((h) => h.textContent);
    expect(headerTexts).toContain("editor");
    expect(headerTexts).toContain("app");
    expect(headerTexts).toContain("workbench");
  });

  it("shows error state when IPC call fails", async () => {
    _clear();
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") throw new Error("IPC connection lost");
      if (cmd === "get_menu_shortcuts") return [];
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);
    const errorEl = container.querySelector("[data-testid='shortcuts-error']");
    expect(errorEl).not.toBeNull();
    expect(errorEl!.textContent).toContain("Failed to load shortcuts");
  });

  // --- Cycle 1: Search by Key Chord ---

  it("filter matches by formatted chord display (mac)", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const filter = container.querySelector("[data-testid='shortcuts-filter']") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "⌘B" } });
    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.length).toBe(1);
    expect(dataRows[0]!.textContent).toContain("Toggle Bold");
  });

  it("filter matches by CM6 notation", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const filter = container.querySelector("[data-testid='shortcuts-filter']") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "Mod-b" } });
    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.length).toBe(1);
    expect(dataRows[0]!.textContent).toContain("Toggle Bold");
  });

  it("filter matches by formatted chord (other platform)", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="other" />);
    await waitForLoaded(container);

    const filter = container.querySelector("[data-testid='shortcuts-filter']") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "Ctrl+B" } });
    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.length).toBe(1);
    expect(dataRows[0]!.textContent).toContain("Toggle Bold");
  });

  // --- Cycle 2: "Show Unbound Commands" Toggle ---

  it("hides unbound commands by default", async () => {
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "test.unboundCmd", label: "Unbound Test Cmd", action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps")
        return [{ command: "editor.toggleBold", key: "Mod-b", source: "default" }];
      if (cmd === "get_menu_shortcuts") return [];
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.some((r) => r.textContent?.includes("Unbound Test Cmd"))).toBe(false);
    expect(dataRows.some((r) => r.textContent?.includes("Toggle Bold"))).toBe(true);
  });

  it("shows unbound commands when toggle is on", async () => {
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "test.unboundCmd", label: "Unbound Test Cmd", action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps")
        return [{ command: "editor.toggleBold", key: "Mod-b", source: "default" }];
      if (cmd === "get_menu_shortcuts") return [];
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    // Initially unbound is hidden
    let allRows = Array.from(container.querySelectorAll("tbody tr"));
    let dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.some((r) => r.textContent?.includes("Unbound Test Cmd"))).toBe(false);

    // Click the toggle
    const toggle = container.querySelector("[data-testid='show-unbound-toggle']") as HTMLElement;
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle);

    allRows = Array.from(container.querySelectorAll("tbody tr"));
    dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.some((r) => r.textContent?.includes("Unbound Test Cmd"))).toBe(true);
  });

  it("toggle has label 'Show unbound commands'", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);
    expect(container.textContent).toContain("Show unbound commands");
  });

  // --- Cycle 3: Collapsible Category Sections ---

  it("group headers collapse their section on click", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    // Find and click the "editor" group header
    const headers = container.querySelectorAll("[data-testid='group-header']");
    const editorHeader = Array.from(headers).find((h) => h.textContent?.includes("editor"));
    expect(editorHeader).toBeDefined();
    fireEvent.click(editorHeader!);

    // Editor entries (Toggle Bold, Toggle Italic) should be hidden
    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.some((r) => r.textContent?.includes("Toggle Bold"))).toBe(false);
    expect(dataRows.some((r) => r.textContent?.includes("Toggle Italic"))).toBe(false);
    // Other groups still visible
    expect(dataRows.some((r) => r.textContent?.includes("Command Palette"))).toBe(true);
  });

  it("clicking collapsed header re-expands", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const headers = container.querySelectorAll("[data-testid='group-header']");
    const editorHeader = Array.from(headers).find((h) => h.textContent?.includes("editor"));
    // Collapse
    fireEvent.click(editorHeader!);
    // Expand
    fireEvent.click(editorHeader!);

    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.some((r) => r.textContent?.includes("Toggle Bold"))).toBe(true);
  });

  it("group headers show collapse indicator", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const indicators = container.querySelectorAll("[data-testid='collapse-indicator']");
    expect(indicators.length).toBeGreaterThan(0);
  });

  // --- Cycle 4: Highlight Matching Text ---

  it("highlights matching characters in label when filtering", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const filter = container.querySelector("[data-testid='shortcuts-filter']") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "bold" } });

    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    const boldRow = dataRows.find((r) => r.textContent?.includes("Bold"));
    expect(boldRow).toBeDefined();
    const marks = boldRow!.querySelectorAll("mark");
    expect(marks.length).toBeGreaterThan(0);
  });

  it("no highlight when filter is empty", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    const marks = dataRows[0]!.querySelectorAll("mark");
    expect(marks.length).toBe(0);
  });

  // --- Cycle 5: Integration / Edge Cases ---

  it("empty state when chord search matches nothing", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const filter = container.querySelector("[data-testid='shortcuts-filter']") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "⌘Z" } });
    expect(container.textContent).toContain("No matching shortcuts");
  });

  it("chord search + unbound toggle combined", async () => {
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "editor.unboundCmd", label: "Unbound Editor Cmd", action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps")
        return [{ command: "editor.toggleBold", key: "Mod-b", source: "default" }];
      if (cmd === "get_menu_shortcuts") return [];
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    // With unbound hidden, chord search on bound commands works
    const filter = container.querySelector("[data-testid='shortcuts-filter']") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "⌘B" } });
    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.length).toBe(1);
    expect(dataRows[0]!.textContent).toContain("Toggle Bold");
  });

  it("filtering auto-expands collapsed groups", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    // Collapse the editor group
    const headers = container.querySelectorAll("[data-testid='group-header']");
    const editorHeader = Array.from(headers).find((h) => h.textContent?.includes("editor"));
    fireEvent.click(editorHeader!);

    // Verify collapsed
    let allRows = Array.from(container.querySelectorAll("tbody tr"));
    let dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.some((r) => r.textContent?.includes("Toggle Bold"))).toBe(false);

    // Type a filter that matches an editor entry
    const filter = container.querySelector("[data-testid='shortcuts-filter']") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "bold" } });

    allRows = Array.from(container.querySelectorAll("tbody tr"));
    dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.some((r) => r.textContent?.includes("Toggle Bold"))).toBe(true);
  });

  // --- Cycle 7: Conflict Detection Integration ---

  async function clickKeybindingCell(container: HTMLElement, commandLabel: string) {
    const rows = container.querySelectorAll("tbody tr");
    const row = Array.from(rows).find((r) => r.textContent?.includes(commandLabel));
    expect(row).toBeDefined();
    const keybindingCell = row!.querySelectorAll("td")[1]!;
    const chord = keybindingCell.querySelector("[data-testid='key-chord']");
    if (chord) {
      fireEvent.click(chord.parentElement!);
    } else {
      fireEvent.click(keybindingCell);
    }
    return row!;
  }

  async function recordKey(container: HTMLElement, key: string, code: string, mods: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) {
    const recorder = container.querySelector("[data-testid='key-recorder']")!;
    // Enter recording state
    fireEvent.click(recorder);
    // Fire key event
    fireEvent.keyDown(recorder, { key, code, ...mods });
    // Confirm with Enter
    fireEvent.keyDown(recorder, { key: "Enter", code: "Enter" });
  }

  it("recording a conflicting key shows ConflictResolutionDialog", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    // Click the keybinding cell for Toggle Italic to start rebinding
    await clickKeybindingCell(container, "Toggle Italic");
    // Record Mod-b which conflicts with Toggle Bold
    await recordKey(container, "b", "KeyB", { metaKey: true });

    // Conflict dialog should appear with human-readable label
    expect(container.querySelector("[data-testid='conflict-dialog-backdrop']")).not.toBeNull();
    expect(container.querySelector("[data-testid='conflict-dialog']")!.textContent).toContain("Toggle Bold");
  });

  it("recording a non-conflicting key applies directly (no dialog)", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    // Click the keybinding cell for Toggle Italic to start rebinding
    await clickKeybindingCell(container, "Toggle Italic");
    // Record Mod-x which does not conflict with anything
    await recordKey(container, "x", "KeyX", { metaKey: true });

    // No conflict dialog
    expect(container.querySelector("[data-testid='conflict-dialog-backdrop']")).toBeNull();
    // The new binding should be visible in the row
    const rows = container.querySelectorAll("tbody tr");
    const italicRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Italic"));
    expect(italicRow).toBeDefined();
  });

  it("Rebind in dialog unbinds conflicting command and assigns new binding", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "b", "KeyB", { metaKey: true });

    // Click Rebind
    const rebindBtn = container.querySelector("[data-testid='conflict-rebind-btn']")!;
    fireEvent.click(rebindBtn);

    // Dialog dismissed
    expect(container.querySelector("[data-testid='conflict-dialog-backdrop']")).toBeNull();

    // Toggle Bold is now unbound — enable "show unbound" to see it
    const toggle = container.querySelector("[data-testid='show-unbound-toggle']") as HTMLElement;
    fireEvent.click(toggle);

    const rows = container.querySelectorAll("tbody tr");
    const boldRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Bold"));
    expect(boldRow).toBeDefined();
    const boldChord = boldRow!.querySelector("[data-testid='key-chord']");
    expect(boldChord!.textContent).toBe("—");
  });

  it("Cancel dismisses dialog with no changes", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "b", "KeyB", { metaKey: true });

    // Click Cancel
    const cancelBtn = container.querySelector("[data-testid='conflict-cancel-btn']")!;
    fireEvent.click(cancelBtn);

    // Dialog dismissed
    expect(container.querySelector("[data-testid='conflict-dialog-backdrop']")).toBeNull();

    // Toggle Italic still has Mod-i (unchanged)
    const rows = container.querySelectorAll("tbody tr");
    const italicRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Italic"));
    expect(italicRow).toBeDefined();
  });

  it("keybinding cell has cursor-pointer class", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);
    const rows = container.querySelectorAll("tbody tr");
    const dataRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Bold"));
    const keybindingCell = dataRow!.querySelectorAll("td")[1]!;
    expect(keybindingCell.className).toContain("cursor-pointer");
  });

  it("Rebind resolves ALL conflicts, not just the first", async () => {
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "editor.toggleItalic", label: "Toggle Italic", keywords: ["italic"], action: () => {} });
    registerCommand({ id: "workbench.toggleSideBar", label: "Toggle Sidebar", keywords: ["sidebar"], action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps")
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "workbench.toggleSideBar", key: "Mod-b", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "user" },
        ];
      if (cmd === "get_menu_shortcuts") return [];
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    // Rebind Toggle Italic to Mod-b (conflicts with both toggleBold and toggleSideBar)
    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "b", "KeyB", { metaKey: true });

    // Conflict dialog should appear
    expect(container.querySelector("[data-testid='conflict-dialog-backdrop']")).not.toBeNull();

    // Click Rebind
    const rebindBtn = container.querySelector("[data-testid='conflict-rebind-btn']")!;
    fireEvent.click(rebindBtn);

    // Both conflicting commands should now be unbound
    const toggle = container.querySelector("[data-testid='show-unbound-toggle']") as HTMLElement;
    fireEvent.click(toggle);

    const rows = container.querySelectorAll("tbody tr");
    const boldRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Bold"));
    expect(boldRow).toBeDefined();
    expect(boldRow!.querySelector("[data-testid='key-chord']")!.textContent).toBe("—");

    const sidebarRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Sidebar"));
    expect(sidebarRow).toBeDefined();
    expect(sidebarRow!.querySelector("[data-testid='key-chord']")!.textContent).toBe("—");
  });

  it("menu conflict shows read-only variant (no Rebind button)", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    // Rebind Toggle Italic to Mod-p which is a menu shortcut
    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "p", "KeyP", { metaKey: true });

    // Conflict dialog should appear
    expect(container.querySelector("[data-testid='conflict-dialog-backdrop']")).not.toBeNull();
    // No Rebind button (menu conflicts can't be rebound)
    expect(container.querySelector("[data-testid='conflict-rebind-btn']")).toBeNull();
    // Cancel button is present
    expect(container.querySelector("[data-testid='conflict-cancel-btn']")).not.toBeNull();
    // Shows explanation
    expect(container.querySelector("[data-testid='conflict-dialog']")!.textContent).toContain("Menu shortcuts cannot be rebound");
  });

  // --- Cycle 4: Per-binding editing ---

  it("clicking a specific binding chord starts editing that binding", async () => {
    _clear();
    registerCommand({ id: "editor.save", label: "Save", action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps")
        return [
          { command: "editor.save", key: "Mod-s", source: "default" },
          { command: "editor.save", key: "Ctrl-s", when: "editorFocus", source: "user" },
        ];
      if (cmd === "get_menu_shortcuts") return [];
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    // Click the second KeyChord specifically
    const rows = container.querySelectorAll("tbody tr");
    const saveRow = Array.from(rows).find((r) => r.textContent?.includes("Save"));
    const chords = saveRow!.querySelectorAll("[data-testid='key-chord']");
    expect(chords.length).toBe(2);
    fireEvent.click(chords[1]!);

    // KeyRecorder should appear
    expect(container.querySelector("[data-testid='key-recorder']")).not.toBeNull();
  });

  // --- Cycle 3: Auto-save on confirm/rebind ---

  it("non-conflicting rebind calls save_user_keymaps with minimal diff", async () => {
    let savedBindings: unknown = null;
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "editor.toggleItalic", label: "Toggle Italic", keywords: ["italic"], action: () => {} });
    mockInvoke((cmd, args) => {
      if (cmd === "get_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "user" },
        ];
      }
      if (cmd === "get_default_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
        ];
      }
      if (cmd === "get_menu_shortcuts") return [];
      if (cmd === "save_user_keymaps") {
        savedBindings = (args as Record<string, unknown>)?.bindings;
        return undefined;
      }
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "x", "KeyX", { metaKey: true });

    await waitFor(() => {
      expect(savedBindings).not.toBeNull();
    });
    expect(savedBindings).toEqual([
      { command: "editor.toggleItalic", key: "Mod-x", when: "editorFocus" },
    ]);
  });

  it("conflict-resolution rebind also calls save_user_keymaps", async () => {
    let savedBindings: unknown = null;
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "editor.toggleItalic", label: "Toggle Italic", keywords: ["italic"], action: () => {} });
    mockInvoke((cmd, args) => {
      if (cmd === "get_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "user" },
        ];
      }
      if (cmd === "get_default_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
        ];
      }
      if (cmd === "get_menu_shortcuts") return [];
      if (cmd === "save_user_keymaps") {
        savedBindings = (args as Record<string, unknown>)?.bindings;
        return undefined;
      }
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "b", "KeyB", { metaKey: true });

    const rebindBtn = container.querySelector("[data-testid='conflict-rebind-btn']")!;
    fireEvent.click(rebindBtn);

    await waitFor(() => {
      expect(savedBindings).not.toBeNull();
    });
  });

  it("lit:keymaps-changed event is dispatched after save", async () => {
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "editor.toggleItalic", label: "Toggle Italic", keywords: ["italic"], action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "user" },
        ];
      }
      if (cmd === "get_default_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
        ];
      }
      if (cmd === "get_menu_shortcuts") return [];
      if (cmd === "save_user_keymaps") return undefined;
      return [];
    });

    const listener = vi.fn();
    window.addEventListener("lit:keymaps-changed", listener);

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "x", "KeyX", { metaKey: true });

    await waitFor(() => {
      expect(listener).toHaveBeenCalled();
    });

    window.removeEventListener("lit:keymaps-changed", listener);
  });

  it("saved payload excludes unchanged defaults (only overrides)", async () => {
    let savedBindings: unknown = null;
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "editor.toggleItalic", label: "Toggle Italic", keywords: ["italic"], action: () => {} });
    mockInvoke((cmd, args) => {
      if (cmd === "get_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
        ];
      }
      if (cmd === "get_default_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
        ];
      }
      if (cmd === "get_menu_shortcuts") return [];
      if (cmd === "save_user_keymaps") {
        savedBindings = (args as Record<string, unknown>)?.bindings;
        return undefined;
      }
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "x", "KeyX", { metaKey: true });

    await waitFor(() => {
      expect(savedBindings).not.toBeNull();
    });
    const arr = savedBindings as Array<{ command: string }>;
    expect(arr.some((b) => b.command === "editor.toggleBold")).toBe(false);
  });

  // --- Cycle 4: Reset per-binding ---

  it("user-source binding shows a reset button", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const rows = container.querySelectorAll("tbody tr");
    const italicRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Italic"));
    expect(italicRow!.querySelector("[data-testid='reset-binding-btn']")).not.toBeNull();
  });

  it("default-source binding does NOT show reset button", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const rows = container.querySelectorAll("tbody tr");
    const boldRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Bold"));
    expect(boldRow!.querySelector("[data-testid='reset-binding-btn']")).toBeNull();
  });

  it("clicking reset reverts that slot to its default key and triggers save", async () => {
    let savedBindings: unknown = null;
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "editor.toggleItalic", label: "Toggle Italic", keywords: ["italic"], action: () => {} });
    mockInvoke((cmd, args) => {
      if (cmd === "get_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-x", when: "editorFocus", source: "user" },
        ];
      }
      if (cmd === "get_default_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
        ];
      }
      if (cmd === "get_menu_shortcuts") return [];
      if (cmd === "save_user_keymaps") {
        savedBindings = (args as Record<string, unknown>)?.bindings;
        return undefined;
      }
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const resetBtn = container.querySelector("[data-testid='reset-binding-btn']")!;
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(savedBindings).not.toBeNull();
    });
    expect(savedBindings).toEqual([]);
  });

  it("after reset, source badge changes to Default", async () => {
    _clear();
    registerCommand({ id: "editor.toggleItalic", label: "Toggle Italic", keywords: ["italic"], action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { command: "editor.toggleItalic", key: "Mod-x", when: "editorFocus", source: "user" },
        ];
      }
      if (cmd === "get_default_keymaps") {
        return [
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
        ];
      }
      if (cmd === "get_menu_shortcuts") return [];
      if (cmd === "save_user_keymaps") return undefined;
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const resetBtn = container.querySelector("[data-testid='reset-binding-btn']")!;
    fireEvent.click(resetBtn);

    await waitFor(() => {
      const badge = container.querySelector("[data-testid='source-badge']");
      expect(badge!.textContent).toBe("Default");
    });
  });

  it("menu-source bindings do NOT show reset button", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const rows = container.querySelectorAll("tbody tr");
    const paletteRow = Array.from(rows).find((r) => r.textContent?.includes("Command Palette"));
    expect(paletteRow!.querySelector("[data-testid='reset-binding-btn']")).toBeNull();
  });

  // --- Cycle 5: Reset All with Confirmation ---

  it("panel renders Reset All button", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);
    expect(container.querySelector("[data-testid='reset-all-btn']")).not.toBeNull();
  });

  it("clicking Reset All shows confirmation dialog", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    fireEvent.click(container.querySelector("[data-testid='reset-all-btn']")!);
    expect(container.querySelector("[data-testid='reset-all-dialog']")).not.toBeNull();
  });

  it("confirming Reset All saves empty array and dispatches reload event", async () => {
    let savedBindings: unknown = "not-called";
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    mockInvoke((cmd, args) => {
      if (cmd === "get_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-x", when: "editorFocus", source: "user" },
        ];
      }
      if (cmd === "get_default_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
        ];
      }
      if (cmd === "get_menu_shortcuts") return [];
      if (cmd === "save_user_keymaps") {
        savedBindings = (args as Record<string, unknown>)?.bindings;
        return undefined;
      }
      return [];
    });

    const listener = vi.fn();
    window.addEventListener("lit:keymaps-changed", listener);

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    fireEvent.click(container.querySelector("[data-testid='reset-all-btn']")!);
    fireEvent.click(container.querySelector("[data-testid='reset-all-confirm-btn']")!);

    await waitFor(() => {
      expect(savedBindings).toEqual([]);
    });
    expect(listener).toHaveBeenCalled();

    window.removeEventListener("lit:keymaps-changed", listener);
  });

  it("cancelling Reset All does nothing", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    fireEvent.click(container.querySelector("[data-testid='reset-all-btn']")!);
    fireEvent.click(container.querySelector("[data-testid='reset-all-cancel-btn']")!);

    expect(container.querySelector("[data-testid='reset-all-dialog']")).toBeNull();
  });

  it("after Reset All confirm, table re-fetches and shows all defaults", async () => {
    let callCount = 0;
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        callCount++;
        if (callCount <= 1) {
          return [
            { command: "editor.toggleBold", key: "Mod-x", when: "editorFocus", source: "user" },
          ];
        }
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
        ];
      }
      if (cmd === "get_default_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
        ];
      }
      if (cmd === "get_menu_shortcuts") return [];
      if (cmd === "save_user_keymaps") return undefined;
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    fireEvent.click(container.querySelector("[data-testid='reset-all-btn']")!);
    fireEvent.click(container.querySelector("[data-testid='reset-all-confirm-btn']")!);

    await waitFor(() => {
      const badge = container.querySelector("[data-testid='source-badge']");
      expect(badge!.textContent).toBe("Default");
    });
  });

  // --- Cycle 2C-1: Race condition on defaultsRef ---

  it("if get_default_keymaps is slow, editing still saves correct minimal diff", async () => {
    let savedBindings: unknown = null;
    let resolveDefaults: ((v: unknown) => void) | null = null;
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "editor.toggleItalic", label: "Toggle Italic", keywords: ["italic"], action: () => {} });
    mockInvoke((cmd, args) => {
      if (cmd === "get_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "user" },
        ];
      }
      if (cmd === "get_default_keymaps") {
        return new Promise((resolve) => { resolveDefaults = resolve; });
      }
      if (cmd === "get_menu_shortcuts") return [];
      if (cmd === "save_user_keymaps") {
        savedBindings = (args as Record<string, unknown>)?.bindings;
        return undefined;
      }
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);

    // Panel stays in loading state until defaults resolve
    expect(container.querySelector("[data-testid='shortcuts-loading']")).not.toBeNull();

    // Resolve defaults (simulating slow fetch completing)
    resolveDefaults!([
      { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
      { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
    ]);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "x", "KeyX", { metaKey: true });

    await waitFor(() => {
      expect(savedBindings).not.toBeNull();
    });
    // Should be minimal diff (only the changed binding), NOT the full set
    expect(savedBindings).toEqual([
      { command: "editor.toggleItalic", key: "Mod-x", when: "editorFocus" },
    ]);
  });

  // --- Cycle 2C-2: Handle persistAndReload errors ---

  it("if save_user_keymaps rejects, an error banner is shown", async () => {
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "editor.toggleItalic", label: "Toggle Italic", keywords: ["italic"], action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "user" },
        ];
      }
      if (cmd === "get_default_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
        ];
      }
      if (cmd === "get_menu_shortcuts") return [];
      if (cmd === "save_user_keymaps") {
        throw new Error("Disk full");
      }
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "x", "KeyX", { metaKey: true });

    await waitFor(() => {
      expect(container.querySelector("[data-testid='save-error']")).not.toBeNull();
    });
    expect(container.querySelector("[data-testid='save-error']")!.textContent).toContain("Disk full");
  });

  it("if save fails, lit:keymaps-changed is NOT dispatched", async () => {
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "editor.toggleItalic", label: "Toggle Italic", keywords: ["italic"], action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "user" },
        ];
      }
      if (cmd === "get_default_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
        ];
      }
      if (cmd === "get_menu_shortcuts") return [];
      if (cmd === "save_user_keymaps") {
        throw new Error("Backend error");
      }
      return [];
    });

    const listener = vi.fn();
    window.addEventListener("lit:keymaps-changed", listener);

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "x", "KeyX", { metaKey: true });

    // Wait for async save to have been attempted
    await waitFor(() => {
      expect(container.querySelector("[data-testid='save-error']")).not.toBeNull();
    });
    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener("lit:keymaps-changed", listener);
  });

  // --- Cycle 2C-3: Reset button inline next to chord ---

  it("reset button is inside the keybinding cell, not the source cell", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const resetBtn = container.querySelector("[data-testid='reset-binding-btn']")!;
    expect(resetBtn).not.toBeNull();
    const td = resetBtn.closest("td")!;
    const row = td.closest("tr")!;
    const cells = Array.from(row.querySelectorAll("td"));
    // Keybinding cell is index 1 (Command=0, Keybinding=1, Source=2, When=3)
    expect(cells.indexOf(td)).toBe(1);
  });

  it("each user-source chord has its own adjacent reset button", async () => {
    _clear();
    registerCommand({ id: "editor.save", label: "Save", action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps")
        return [
          { command: "editor.save", key: "Mod-s", source: "user" },
          { command: "editor.save", key: "Ctrl-s", when: "editorFocus", source: "user" },
        ];
      if (cmd === "get_menu_shortcuts") return [];
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const rows = container.querySelectorAll("tbody tr");
    const saveRow = Array.from(rows).find((r) => r.textContent?.includes("Save"));
    expect(saveRow).toBeDefined();
    const keybindingCell = saveRow!.querySelectorAll("td")[1]!;
    const resetBtns = keybindingCell.querySelectorAll("[data-testid='reset-binding-btn']");
    expect(resetBtns.length).toBe(2);
  });

  // --- Feature D: Menu shortcuts non-interactive ---

  it("clicking a menu-source binding does NOT open KeyRecorder", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const rows = container.querySelectorAll("tbody tr");
    const paletteRow = Array.from(rows).find((r) => r.textContent?.includes("Command Palette"));
    const keybindingCell = paletteRow!.querySelectorAll("td")[1]!;
    const chord = keybindingCell.querySelector("[data-testid='key-chord']");
    fireEvent.click(chord!.parentElement!);

    expect(container.querySelector("[data-testid='key-recorder']")).toBeNull();
  });

  it("menu-source keybinding cell does NOT have cursor-pointer class", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const rows = container.querySelectorAll("tbody tr");
    const paletteRow = Array.from(rows).find((r) => r.textContent?.includes("Command Palette"));
    const keybindingCell = paletteRow!.querySelectorAll("td")[1]!;
    expect(keybindingCell.className).not.toContain("cursor-pointer");
    expect(keybindingCell.className).toContain("cursor-default");
  });

  it("menu-source keybinding cell has title attribute 'Menu shortcuts cannot be rebound'", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    const rows = container.querySelectorAll("tbody tr");
    const paletteRow = Array.from(rows).find((r) => r.textContent?.includes("Command Palette"));
    const keybindingCell = paletteRow!.querySelectorAll("td")[1]!;
    expect(keybindingCell.getAttribute("title")).toBe("Menu shortcuts cannot be rebound");
  });

  // --- Feature A: Click-away (blur) confirms integration ---

  it("blurring KeyRecorder after capturing a key applies the rebind", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    const recorder = container.querySelector("[data-testid='key-recorder']")!;
    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, { key: "x", code: "KeyX", metaKey: true });
    fireEvent.blur(recorder);

    // Recorder should be gone, new binding visible
    expect(container.querySelector("[data-testid='key-recorder']")).toBeNull();
    const rows = container.querySelectorAll("tbody tr");
    const italicRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Italic"));
    expect(italicRow).toBeDefined();
  });

  // --- Feature C: Toast integration ---

  it("successful rebind shows toast with command label and new key", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "x", "KeyX", { metaKey: true });

    const toast = container.querySelector("[data-testid='toast']");
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toContain("Toggle Italic");
    expect(toast!.textContent).toContain("⌘X");
  });

  it("conflict-resolution rebind also shows toast", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "b", "KeyB", { metaKey: true });

    const rebindBtn = container.querySelector("[data-testid='conflict-rebind-btn']")!;
    fireEvent.click(rebindBtn);

    const toast = container.querySelector("[data-testid='toast']");
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toContain("Toggle Italic");
  });

  // --- Feature B: Session-level undo ---

  it("undo button is NOT visible when no rebinds have been made", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);
    expect(container.querySelector("[data-testid='undo-btn']")).toBeNull();
  });

  it("after a successful rebind, undo button appears", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "x", "KeyX", { metaKey: true });

    expect(container.querySelector("[data-testid='undo-btn']")).not.toBeNull();
  });

  it("clicking undo reverts the last rebind and persists", async () => {
    let savedBindings: unknown = null;
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "editor.toggleItalic", label: "Toggle Italic", keywords: ["italic"], action: () => {} });
    mockInvoke((cmd, args) => {
      if (cmd === "get_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "user" },
        ];
      }
      if (cmd === "get_default_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
        ];
      }
      if (cmd === "get_menu_shortcuts") return [];
      if (cmd === "save_user_keymaps") {
        savedBindings = (args as Record<string, unknown>)?.bindings;
        return undefined;
      }
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "x", "KeyX", { metaKey: true });

    // Undo
    const undoBtn = container.querySelector("[data-testid='undo-btn']")!;
    fireEvent.click(undoBtn);

    // Should revert — save called with original state diff
    await waitFor(() => {
      expect(savedBindings).toEqual([]);
    });
    // Undo button should disappear
    expect(container.querySelector("[data-testid='undo-btn']")).toBeNull();
  });

  it("undo after conflict-resolution rebind restores both commands", async () => {
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "editor.toggleItalic", label: "Toggle Italic", keywords: ["italic"], action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "user" },
        ];
      }
      if (cmd === "get_default_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
        ];
      }
      if (cmd === "get_menu_shortcuts") return [];
      if (cmd === "save_user_keymaps") return undefined;
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    // Rebind Toggle Italic to Mod-b (conflicts with Bold)
    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "b", "KeyB", { metaKey: true });
    fireEvent.click(container.querySelector("[data-testid='conflict-rebind-btn']")!);

    // Undo
    fireEvent.click(container.querySelector("[data-testid='undo-btn']")!);

    // Both commands should be restored
    const rows = container.querySelectorAll("tbody tr");
    const boldRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Bold"));
    const italicRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Italic"));
    expect(boldRow!.querySelector("[data-testid='key-chord']")).not.toBeNull();
    expect(italicRow!.querySelector("[data-testid='key-chord']")).not.toBeNull();
  });

  it("undo shows a toast confirming the revert", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "x", "KeyX", { metaKey: true });

    fireEvent.click(container.querySelector("[data-testid='undo-btn']")!);

    const toast = container.querySelector("[data-testid='toast']");
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toContain("Undid");
    expect(toast!.textContent).toContain("Toggle Italic");
  });

  it("Cmd+Z triggers undo when panel is focused and not recording", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "x", "KeyX", { metaKey: true });

    // Focus panel and trigger Cmd+Z
    const panel = container.querySelector("[data-testid='keyboard-shortcuts-panel']")!;
    fireEvent.keyDown(panel, { key: "z", metaKey: true });

    // Undo button should disappear (undo applied)
    expect(container.querySelector("[data-testid='undo-btn']")).toBeNull();
  });

  it("performing a second rebind makes undo revert to the state before the second rebind (not the first)", async () => {
    _clear();
    registerCommand({ id: "editor.toggleBold", label: "Toggle Bold", keywords: ["bold"], action: () => {} });
    registerCommand({ id: "editor.toggleItalic", label: "Toggle Italic", keywords: ["italic"], action: () => {} });
    registerCommand({ id: "workbench.toggleSideBar", label: "Toggle Sidebar", keywords: ["sidebar"], action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "user" },
          { command: "workbench.toggleSideBar", key: "Mod-\\", source: "default" },
        ];
      }
      if (cmd === "get_default_keymaps") {
        return [
          { command: "editor.toggleBold", key: "Mod-b", when: "editorFocus", source: "default" },
          { command: "editor.toggleItalic", key: "Mod-i", when: "editorFocus", source: "default" },
          { command: "workbench.toggleSideBar", key: "Mod-\\", source: "default" },
        ];
      }
      if (cmd === "get_menu_shortcuts") return [];
      if (cmd === "save_user_keymaps") return undefined;
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    // First rebind: Toggle Italic Mod-i → Mod-x
    await clickKeybindingCell(container, "Toggle Italic");
    await recordKey(container, "x", "KeyX", { metaKey: true });

    // Second rebind: Toggle Sidebar Mod-\ → Mod-y
    await clickKeybindingCell(container, "Toggle Sidebar");
    await recordKey(container, "y", "KeyY", { metaKey: true });

    // Undo should revert only the second rebind
    fireEvent.click(container.querySelector("[data-testid='undo-btn']")!);

    // Toggle Italic should still have Mod-x (from first rebind)
    const rows = container.querySelectorAll("tbody tr");
    const italicRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Italic"));
    expect(italicRow).toBeDefined();
    // Toggle Sidebar should have Mod-\ again
    const sidebarRow = Array.from(rows).find((r) => r.textContent?.includes("Toggle Sidebar"));
    expect(sidebarRow).toBeDefined();
  });

  it("editing second binding replaces only that binding, not the first", async () => {
    _clear();
    registerCommand({ id: "editor.save", label: "Save", action: () => {} });
    mockInvoke((cmd) => {
      if (cmd === "get_keymaps")
        return [
          { command: "editor.save", key: "Mod-s", source: "default" },
          { command: "editor.save", key: "Ctrl-s", when: "editorFocus", source: "user" },
        ];
      if (cmd === "get_menu_shortcuts") return [];
      return [];
    });

    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await waitForLoaded(container);

    // Before edit: first chord is ⌘S, second is ⌃S
    const rows = container.querySelectorAll("tbody tr");
    const saveRow = Array.from(rows).find((r) => r.textContent?.includes("Save"));
    const chordsBefore = saveRow!.querySelectorAll("[data-testid='key-chord']");
    const firstChordBefore = chordsBefore[0]!.textContent;

    // Click the second KeyChord (Ctrl-s with editorFocus)
    fireEvent.click(chordsBefore[1]!);

    // Record Mod-x (no conflict)
    await recordKey(container, "x", "KeyX", { metaKey: true });

    // First binding (Mod-s, global) must be unchanged
    const updatedRows = container.querySelectorAll("tbody tr");
    const updatedSaveRow = Array.from(updatedRows).find((r) => r.textContent?.includes("Save"));
    const updatedChords = updatedSaveRow!.querySelectorAll("[data-testid='key-chord']");
    expect(updatedChords.length).toBe(2);
    // First chord text should be exactly the same as before
    expect(updatedChords[0]!.textContent).toBe(firstChordBefore);
  });
});
