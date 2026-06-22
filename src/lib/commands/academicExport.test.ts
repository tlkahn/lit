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

import { initAcademicExportCommands } from "./academicExport";

describe("initAcademicExportCommands", () => {
  beforeEach(() => {
    _clear();
    vi.clearAllMocks();
    mockWorkspaceState.workspacePath = "/tmp/vault";
    mockWorkspaceState.currentPagePath = "hello.md";
  });

  it("registers academic.exportLatex command", () => {
    initAcademicExportCommands();
    expect(hasCommand("academic.exportLatex")).toBe(true);
  });

  it("registers academic.exportHtml command", () => {
    initAcademicExportCommands();
    expect(hasCommand("academic.exportHtml")).toBe(true);
  });

  it("registers academic.exportDocx command", () => {
    initAcademicExportCommands();
    expect(hasCommand("academic.exportDocx")).toBe(true);
  });

  it("calling init twice does not duplicate", () => {
    initAcademicExportCommands();
    initAcademicExportCommands();
    const commands = getAllCommands();
    const exportCmds = commands.filter((c) => c.id.startsWith("academic."));
    expect(exportCmds).toHaveLength(3);
  });

  it("hidden when no page selected", () => {
    initAcademicExportCommands();
    mockWorkspaceState.currentPagePath = null;
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "academic.exportLatex")).toBeUndefined();
  });

  it("hidden when no workspace open", () => {
    initAcademicExportCommands();
    mockWorkspaceState.workspacePath = null;
    mockWorkspaceState.currentPagePath = null;
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "academic.exportLatex")).toBeUndefined();
  });

  it("visible when page is selected", () => {
    initAcademicExportCommands();
    mockWorkspaceState.currentPagePath = "hello.md";
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "academic.exportLatex")).toBeDefined();
  });

  it("searchable by keyword 'latex'", () => {
    initAcademicExportCommands();
    mockWorkspaceState.currentPagePath = "hello.md";
    const visible = getVisibleCommands("latex");
    expect(visible.find((c) => c.id === "academic.exportLatex")).toBeDefined();
  });

  it("searchable by keyword 'pandoc'", () => {
    initAcademicExportCommands();
    mockWorkspaceState.currentPagePath = "hello.md";
    const visible = getVisibleCommands("pandoc");
    expect(visible.find((c) => c.id === "academic.exportLatex")).toBeDefined();
  });

  it("html command hidden when no page", () => {
    initAcademicExportCommands();
    mockWorkspaceState.currentPagePath = null;
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "academic.exportHtml")).toBeUndefined();
  });

  it("html command visible when page selected", () => {
    initAcademicExportCommands();
    mockWorkspaceState.currentPagePath = "hello.md";
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "academic.exportHtml")).toBeDefined();
  });

  it("searchable by keyword 'html'", () => {
    initAcademicExportCommands();
    mockWorkspaceState.currentPagePath = "hello.md";
    const visible = getVisibleCommands("html");
    expect(visible.find((c) => c.id === "academic.exportHtml")).toBeDefined();
  });

  it("searchable by keyword 'web'", () => {
    initAcademicExportCommands();
    mockWorkspaceState.currentPagePath = "hello.md";
    const visible = getVisibleCommands("web");
    expect(visible.find((c) => c.id === "academic.exportHtml")).toBeDefined();
  });

  it("docx command hidden when no page", () => {
    initAcademicExportCommands();
    mockWorkspaceState.currentPagePath = null;
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "academic.exportDocx")).toBeUndefined();
  });

  it("docx command visible when page selected", () => {
    initAcademicExportCommands();
    mockWorkspaceState.currentPagePath = "hello.md";
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "academic.exportDocx")).toBeDefined();
  });

  it("searchable by keyword 'docx'", () => {
    initAcademicExportCommands();
    mockWorkspaceState.currentPagePath = "hello.md";
    const visible = getVisibleCommands("docx");
    expect(visible.find((c) => c.id === "academic.exportDocx")).toBeDefined();
  });

  it("searchable by keyword 'word'", () => {
    initAcademicExportCommands();
    mockWorkspaceState.currentPagePath = "hello.md";
    const visible = getVisibleCommands("word");
    expect(visible.find((c) => c.id === "academic.exportDocx")).toBeDefined();
  });

  // --- New tests: commands dispatch lit:open-academic-export event ---

  it("latex action dispatches lit:open-academic-export with format latex", () => {
    initAcademicExportCommands();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const cmd = getAllCommands().find((c) => c.id === "academic.exportLatex")!;
    cmd.action();
    const event = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === "lit:open-academic-export",
    );
    expect(event).toBeDefined();
    expect((event![0] as CustomEvent).detail).toEqual({ format: "latex" });
    dispatchSpy.mockRestore();
  });

  it("html action dispatches lit:open-academic-export with format html", () => {
    initAcademicExportCommands();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const cmd = getAllCommands().find((c) => c.id === "academic.exportHtml")!;
    cmd.action();
    const event = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === "lit:open-academic-export",
    );
    expect(event).toBeDefined();
    expect((event![0] as CustomEvent).detail).toEqual({ format: "html" });
    dispatchSpy.mockRestore();
  });

  it("docx action dispatches lit:open-academic-export with format docx", () => {
    initAcademicExportCommands();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const cmd = getAllCommands().find((c) => c.id === "academic.exportDocx")!;
    cmd.action();
    const event = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === "lit:open-academic-export",
    );
    expect(event).toBeDefined();
    expect((event![0] as CustomEvent).detail).toEqual({ format: "docx" });
    dispatchSpy.mockRestore();
  });
});
