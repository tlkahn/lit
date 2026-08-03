import { describe, it, expect, vi, beforeEach } from "vitest";
import { _clear, getAllCommands, getVisibleCommands, hasCommand } from "../commandRegistry";

const mockWorkspaceState = vi.hoisted(() => ({
  workspacePath: "/tmp/vault" as string | null,
  currentPagePath: "hello.md" as string | null,
}));

vi.mock("../../stores/workspace", () => ({
  useWorkspaceStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockWorkspaceState),
    { getState: () => mockWorkspaceState },
  ),
}));

const mockExportCardboxToHtml = vi.fn();
vi.mock("../cardboxHtmlExportFlow", () => ({
  exportCardboxToHtml: (...args: unknown[]) => mockExportCardboxToHtml(...args),
}));

import { initCardboxHtmlExportCommands } from "./cardboxHtmlExport";

describe("initCardboxHtmlExportCommands", () => {
  beforeEach(() => {
    _clear();
    vi.clearAllMocks();
    mockWorkspaceState.workspacePath = "/tmp/vault";
    mockWorkspaceState.currentPagePath = "hello.md";
  });

  it("registers cardbox.exportHtml command", () => {
    initCardboxHtmlExportCommands();
    expect(hasCommand("cardbox.exportHtml")).toBe(true);
  });

  it("calling init twice does not duplicate", () => {
    initCardboxHtmlExportCommands();
    initCardboxHtmlExportCommands();
    const commands = getAllCommands();
    const exportCmds = commands.filter((c) => c.id === "cardbox.exportHtml");
    expect(exportCmds).toHaveLength(1);
  });

  it("hidden when no page selected", () => {
    initCardboxHtmlExportCommands();
    mockWorkspaceState.currentPagePath = null;
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "cardbox.exportHtml")).toBeUndefined();
  });

  it("hidden when no workspace open", () => {
    initCardboxHtmlExportCommands();
    mockWorkspaceState.workspacePath = null;
    mockWorkspaceState.currentPagePath = null;
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "cardbox.exportHtml")).toBeUndefined();
  });

  it("visible when page is selected", () => {
    initCardboxHtmlExportCommands();
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "cardbox.exportHtml")).toBeDefined();
  });

  it("searchable by keyword 'cardbox'", () => {
    initCardboxHtmlExportCommands();
    const visible = getVisibleCommands("cardbox");
    expect(visible.find((c) => c.id === "cardbox.exportHtml")).toBeDefined();
  });

  it("searchable by keyword 'html'", () => {
    initCardboxHtmlExportCommands();
    const visible = getVisibleCommands("html");
    expect(visible.find((c) => c.id === "cardbox.exportHtml")).toBeDefined();
  });

  it("searchable by keyword 'export'", () => {
    initCardboxHtmlExportCommands();
    const visible = getVisibleCommands("export");
    expect(visible.find((c) => c.id === "cardbox.exportHtml")).toBeDefined();
  });

  it("action calls exportCardboxToHtml with currentPagePath", () => {
    initCardboxHtmlExportCommands();
    const cmd = getAllCommands().find((c) => c.id === "cardbox.exportHtml")!;
    cmd.action();
    expect(mockExportCardboxToHtml).toHaveBeenCalledWith("hello.md");
  });
});
