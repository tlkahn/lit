import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { mockInvoke, resetInvokeMock } from "../test/tauri-mock";
import { registerCommand, _clear } from "../lib/commandRegistry";
import { KeyboardShortcutsPanel } from "./KeyboardShortcutsPanel";

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
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(container.querySelector("[data-testid='keyboard-shortcuts-table']")).not.toBeNull();
  });

  it("renders column headers: Command, Keybinding, Source, When", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await act(() => new Promise((r) => setTimeout(r, 10)));
    const headers = container.querySelectorAll("th");
    const texts = Array.from(headers).map((h) => h.textContent);
    expect(texts).toContain("Command");
    expect(texts).toContain("Keybinding");
    expect(texts).toContain("Source");
    expect(texts).toContain("When");
  });

  it("shows bound entry with command label, KeyChord, and source badge", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await act(() => new Promise((r) => setTimeout(r, 10)));
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
    await act(() => new Promise((r) => setTimeout(r, 10)));
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
    await act(() => new Promise((r) => setTimeout(r, 10)));
    const rows = container.querySelectorAll("tbody tr");
    const ghostRow = Array.from(rows).find((r) => r.textContent?.includes("ghost.command"));
    expect(ghostRow).toBeDefined();
    const italic = ghostRow!.querySelector("em");
    expect(italic).not.toBeNull();
    expect(italic!.textContent).toBe("ghost.command");
  });

  it("styles source badges: default=muted, user=accent, menu=distinct", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await act(() => new Promise((r) => setTimeout(r, 10)));
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
    await act(() => new Promise((r) => setTimeout(r, 10)));
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
    await act(() => new Promise((r) => setTimeout(r, 10)));

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
    await act(() => new Promise((r) => setTimeout(r, 10)));

    const filter = container.querySelector("[data-testid='shortcuts-filter']") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "workbench" } });
    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.length).toBe(1);
    expect(dataRows[0]!.textContent).toContain("Toggle Sidebar");
  });

  it("filter matches keywords", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await act(() => new Promise((r) => setTimeout(r, 10)));

    const filter = container.querySelector("[data-testid='shortcuts-filter']") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "strong" } });
    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const dataRows = allRows.filter((r) => !r.querySelector("[data-testid='group-header']"));
    expect(dataRows.length).toBe(1);
    expect(dataRows[0]!.textContent).toContain("Toggle Bold");
  });

  it("shows empty state when filter matches nothing", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await act(() => new Promise((r) => setTimeout(r, 10)));

    const filter = container.querySelector("[data-testid='shortcuts-filter']") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "zzzznothing" } });
    expect(container.textContent).toContain("No matching shortcuts");
  });

  it("groups commands by prefix with group headers", async () => {
    const { container } = render(<KeyboardShortcutsPanel platform="mac" />);
    await act(() => new Promise((r) => setTimeout(r, 10)));
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
    await act(() => new Promise((r) => setTimeout(r, 10)));
    const errorEl = container.querySelector("[data-testid='shortcuts-error']");
    expect(errorEl).not.toBeNull();
    expect(errorEl!.textContent).toContain("Failed to load shortcuts");
  });
});
