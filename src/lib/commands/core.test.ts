import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { _clear, getAllCommands, getVisibleCommands, hasCommand, executeCommand } from "../commandRegistry";

const mockWorkspaceState = vi.hoisted(() => ({
  workspacePath: "/tmp/vault" as string | null,
  currentPagePath: "hello.md" as string | null,
  refreshPages: vi.fn(),
  pages: [] as Array<{ title: string }>,
  createPage: vi.fn(),
}));

const mockPreferencesState = vi.hoisted(() => ({
  darkMode: "auto" as "light" | "dark" | "auto",
}));

const mockSetPreference = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

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

vi.mock("../ipc", () => ({
  setPreference: mockSetPreference,
}));

import { initCoreCommands } from "./core";

describe("initCoreCommands", () => {
  beforeEach(() => {
    _clear();
    vi.clearAllMocks();
    mockWorkspaceState.workspacePath = "/tmp/vault";
    mockWorkspaceState.currentPagePath = "hello.md";
    mockWorkspaceState.pages = [];
    mockWorkspaceState.createPage = vi.fn();
    mockPreferencesState.darkMode = "auto";
  });

  it("registers exactly 9 commands with expected IDs", () => {
    initCoreCommands();
    const commands = getAllCommands();
    expect(commands).toHaveLength(9);
    const ids = commands.map((c) => c.id).sort();
    expect(ids).toEqual([
      "app.newPage",
      "core.graph.rebuildIndex",
      "core.page.copyPath",
      "core.page.delete",
      "core.page.new",
      "core.page.rename",
      "core.settings.open",
      "core.theme.toggle",
      "core.workspace.reload",
    ]);
  });

  it("registers 8 visible (labeled) commands; app.newPage alias is hidden", () => {
    initCoreCommands();
    expect(getVisibleCommands()).toHaveLength(8);
    expect(getVisibleCommands().some((c) => c.id === "app.newPage")).toBe(false);
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


  it("core.page.copyPath writes current page path to clipboard", () => {
    initCoreCommands();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const original = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    mockWorkspaceState.currentPagePath = "notes/hello.md";
    const cmd = getAllCommands().find((c) => c.id === "core.page.copyPath")!;
    cmd.action();
    expect(writeText).toHaveBeenCalledWith("notes/hello.md");
    Object.defineProperty(navigator, "clipboard", {
      value: original,
      writable: true,
      configurable: true,
    });
  });

  it("core.page.new calls createPage with the next untitled name", async () => {
    initCoreCommands();
    mockWorkspaceState.pages = [{ title: "Untitled" }];
    const cmd = getAllCommands().find((c) => c.id === "core.page.new")!;
    cmd.action();
    await waitFor(() => {
      expect(mockWorkspaceState.createPage).toHaveBeenCalledWith("Untitled 1");
    });
  });

  it("core.page.new does not dispatch lit:new-page", () => {
    initCoreCommands();
    const handler = vi.fn();
    window.addEventListener("lit:new-page", handler);
    const cmd = getAllCommands().find((c) => c.id === "core.page.new")!;
    cmd.action();
    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener("lit:new-page", handler);
  });

  it("core.page.new no-ops when no workspace is open", () => {
    initCoreCommands();
    mockWorkspaceState.workspacePath = null;
    const cmd = getAllCommands().find((c) => c.id === "core.page.new")!;
    cmd.action();
    expect(mockWorkspaceState.createPage).not.toHaveBeenCalled();
  });

  it("app.newPage alias is registered and creates an untitled page", async () => {
    initCoreCommands();
    expect(hasCommand("app.newPage")).toBe(true);
    executeCommand("app.newPage");
    await waitFor(() => {
      expect(mockWorkspaceState.createPage).toHaveBeenCalledWith("Untitled");
    });
  });

  it("app.newPage alias is hidden from the palette (no label)", () => {
    initCoreCommands();
    const cmd = getAllCommands().find((c) => c.id === "app.newPage")!;
    expect(cmd.label).toBeUndefined();
  });

  it("app.newPage when is false without a workspace and true with one", () => {
    initCoreCommands();
    const cmd = getAllCommands().find((c) => c.id === "app.newPage")!;
    expect(cmd.when).toBeTypeOf("function");
    mockWorkspaceState.workspacePath = null;
    expect(cmd.when!()).toBe(false);
    mockWorkspaceState.workspacePath = "/tmp/vault";
    expect(cmd.when!()).toBe(true);
  });

  it("core.page.new keywords include file and untitled", () => {
    initCoreCommands();
    const cmd = getAllCommands().find((c) => c.id === "core.page.new")!;
    expect(cmd.keywords).toEqual(
      expect.arrayContaining(["create", "new", "page", "file", "untitled"]),
    );
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

  it("core.settings.open dispatches lit:open-settings event", () => {
    initCoreCommands();
    const handler = vi.fn();
    window.addEventListener("lit:open-settings", handler);
    const cmd = getAllCommands().find((c) => c.id === "core.settings.open")!;
    cmd.action();
    expect(handler).toHaveBeenCalledOnce();
    window.removeEventListener("lit:open-settings", handler);
  });

  it("core.workspace.reload calls refreshPages", () => {
    initCoreCommands();
    const cmd = getAllCommands().find((c) => c.id === "core.workspace.reload")!;
    cmd.action();
    expect(mockWorkspaceState.refreshPages).toHaveBeenCalledOnce();
  });

  it("calling initCoreCommands twice does not duplicate commands", () => {
    initCoreCommands();
    initCoreCommands();
    const commands = getAllCommands();
    expect(commands).toHaveLength(9);
  });

  it("visible commands have icons", () => {
    initCoreCommands();
    const commands = getVisibleCommands();
    for (const cmd of commands) {
      expect(cmd.icon).toBeDefined();
    }
  });
});
