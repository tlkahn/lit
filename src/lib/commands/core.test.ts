import { describe, it, expect, vi, beforeEach } from "vitest";
import { _clear, getAllCommands } from "../commandRegistry";

const mockWorkspaceState = vi.hoisted(() => ({
  workspacePath: "/tmp/vault" as string | null,
  currentPagePath: "hello.md" as string | null,
  refreshPages: vi.fn(),
  selectPageAtLine: vi.fn(),
}));

const mockPreferencesState = vi.hoisted(() => ({
  darkMode: "auto" as "light" | "dark" | "auto",
}));

const mockFocusModeState = vi.hoisted(() => ({
  toggleFocusMode: vi.fn(),
}));

const mockSetPreference = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetPreferencesPath = vi.hoisted(() => vi.fn().mockResolvedValue("/tmp/prefs.json"));

vi.mock("../../stores/workspace", () => ({
  useWorkspaceStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockWorkspaceState),
    { getState: () => mockWorkspaceState },
  ),
}));

vi.mock("../../stores/preferences", () => ({
  usePreferencesStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockPreferencesState),
    { getState: () => mockPreferencesState },
  ),
}));

vi.mock("../../stores/focusMode", () => ({
  useFocusModeStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockFocusModeState),
    { getState: () => mockFocusModeState },
  ),
}));

vi.mock("../ipc", () => ({
  setPreference: mockSetPreference,
  getPreferencesPath: mockGetPreferencesPath,
}));

import { initCoreCommands } from "./core";

describe("initCoreCommands", () => {
  beforeEach(() => {
    _clear();
    vi.clearAllMocks();
    mockWorkspaceState.workspacePath = "/tmp/vault";
    mockWorkspaceState.currentPagePath = "hello.md";
    mockPreferencesState.darkMode = "auto";
  });

  it("registers exactly 8 commands with expected IDs", () => {
    initCoreCommands();
    const commands = getAllCommands();
    expect(commands).toHaveLength(8);
    const ids = commands.map((c) => c.id).sort();
    expect(ids).toEqual([
      "core.focus.toggle",
      "core.page.copyPath",
      "core.page.delete",
      "core.page.new",
      "core.page.rename",
      "core.settings.open",
      "core.theme.toggle",
      "core.workspace.reload",
    ]);
  });

  it("core.page.rename/delete/copyPath have when returning false when no page selected", () => {
    initCoreCommands();
    mockWorkspaceState.currentPagePath = null;
    const commands = getAllCommands();
    const pageSelectedIds = ["core.page.rename", "core.page.delete", "core.page.copyPath"];
    const pageCommands = commands.filter((c) => pageSelectedIds.includes(c.id));
    expect(pageCommands).toHaveLength(3);
    for (const cmd of pageCommands) {
      expect(cmd.when!()).toBe(false);
    }
  });

  it("core.page.rename/delete/copyPath have when returning true when page is selected", () => {
    initCoreCommands();
    mockWorkspaceState.currentPagePath = "hello.md";
    const commands = getAllCommands();
    const pageSelectedIds = ["core.page.rename", "core.page.delete", "core.page.copyPath"];
    const pageCommands = commands.filter((c) => pageSelectedIds.includes(c.id));
    for (const cmd of pageCommands) {
      expect(cmd.when!()).toBe(true);
    }
  });

  it("core.page.new requires workspace but not page selected", () => {
    initCoreCommands();
    mockWorkspaceState.currentPagePath = null;
    const cmd = getAllCommands().find((c) => c.id === "core.page.new")!;
    expect(cmd.when!()).toBe(true);
  });

  it("core.workspace.* and core.settings.open have when returning false when no workspace", () => {
    initCoreCommands();
    mockWorkspaceState.workspacePath = null;
    const commands = getAllCommands();
    const workspaceIds = ["core.workspace.reload", "core.settings.open", "core.page.new"];
    const wsCommands = commands.filter((c) => workspaceIds.includes(c.id));
    expect(wsCommands).toHaveLength(3);
    for (const cmd of wsCommands) {
      expect(cmd.when!()).toBe(false);
    }
  });

  it("core.theme.toggle cycles auto → dark → light → auto", () => {
    initCoreCommands();
    const cmd = getAllCommands().find((c) => c.id === "core.theme.toggle")!;

    mockPreferencesState.darkMode = "auto";
    cmd.action();
    expect(mockSetPreference).toHaveBeenLastCalledWith("workbench.darkMode", "dark");

    mockPreferencesState.darkMode = "dark";
    cmd.action();
    expect(mockSetPreference).toHaveBeenLastCalledWith("workbench.darkMode", "light");

    mockPreferencesState.darkMode = "light";
    cmd.action();
    expect(mockSetPreference).toHaveBeenLastCalledWith("workbench.darkMode", "auto");
  });

  it("core.focus.toggle calls toggleFocusMode", () => {
    initCoreCommands();
    const cmd = getAllCommands().find((c) => c.id === "core.focus.toggle")!;
    cmd.action();
    expect(mockFocusModeState.toggleFocusMode).toHaveBeenCalledOnce();
  });

  it("core.page.copyPath writes current page path to clipboard", () => {
    initCoreCommands();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    mockWorkspaceState.currentPagePath = "notes/hello.md";
    const cmd = getAllCommands().find((c) => c.id === "core.page.copyPath")!;
    cmd.action();
    expect(writeText).toHaveBeenCalledWith("notes/hello.md");
  });

  it("core.page.new dispatches lit:new-page event", () => {
    initCoreCommands();
    const handler = vi.fn();
    window.addEventListener("lit:new-page", handler);
    const cmd = getAllCommands().find((c) => c.id === "core.page.new")!;
    cmd.action();
    expect(handler).toHaveBeenCalledOnce();
    window.removeEventListener("lit:new-page", handler);
  });

  it("core.page.rename dispatches lit:rename-page event", () => {
    initCoreCommands();
    const handler = vi.fn();
    window.addEventListener("lit:rename-page", handler);
    const cmd = getAllCommands().find((c) => c.id === "core.page.rename")!;
    cmd.action();
    expect(handler).toHaveBeenCalledOnce();
    window.removeEventListener("lit:rename-page", handler);
  });

  it("core.page.delete dispatches lit:delete-page event", () => {
    initCoreCommands();
    const handler = vi.fn();
    window.addEventListener("lit:delete-page", handler);
    const cmd = getAllCommands().find((c) => c.id === "core.page.delete")!;
    cmd.action();
    expect(handler).toHaveBeenCalledOnce();
    window.removeEventListener("lit:delete-page", handler);
  });

  it("core.settings.open calls getPreferencesPath then selectPageAtLine", async () => {
    initCoreCommands();
    const cmd = getAllCommands().find((c) => c.id === "core.settings.open")!;
    cmd.action();
    await vi.waitFor(() => {
      expect(mockGetPreferencesPath).toHaveBeenCalledOnce();
      expect(mockWorkspaceState.selectPageAtLine).toHaveBeenCalledWith("/tmp/prefs.json", 1, undefined, true);
    });
  });

  it("core.workspace.reload calls refreshPages", () => {
    initCoreCommands();
    const cmd = getAllCommands().find((c) => c.id === "core.workspace.reload")!;
    cmd.action();
    expect(mockWorkspaceState.refreshPages).toHaveBeenCalledOnce();
  });
});
