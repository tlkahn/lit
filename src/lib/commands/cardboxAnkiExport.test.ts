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

const mockExportCardboxToAnki = vi.fn();
vi.mock("../cardboxAnkiExportFlow", () => ({
  exportCardboxToAnki: (...args: unknown[]) => mockExportCardboxToAnki(...args),
}));

import { initCardboxAnkiExportCommands } from "./cardboxAnkiExport";

describe("initCardboxAnkiExportCommands", () => {
  beforeEach(() => {
    _clear();
    vi.clearAllMocks();
    mockWorkspaceState.workspacePath = "/tmp/vault";
    mockWorkspaceState.currentPagePath = "hello.md";
  });

  // P1
  it("P1: registers cardbox.exportAnki command", () => {
    initCardboxAnkiExportCommands();
    expect(hasCommand("cardbox.exportAnki")).toBe(true);
  });

  // P2
  it("P2: calling init twice does not duplicate", () => {
    initCardboxAnkiExportCommands();
    initCardboxAnkiExportCommands();
    const commands = getAllCommands();
    const exportCmds = commands.filter((c) => c.id === "cardbox.exportAnki");
    expect(exportCmds).toHaveLength(1);
  });

  // P3
  it("P3a: hidden when no page selected", () => {
    initCardboxAnkiExportCommands();
    mockWorkspaceState.currentPagePath = null;
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "cardbox.exportAnki")).toBeUndefined();
  });

  it("P3b: hidden when no workspace open", () => {
    initCardboxAnkiExportCommands();
    mockWorkspaceState.workspacePath = null;
    mockWorkspaceState.currentPagePath = null;
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "cardbox.exportAnki")).toBeUndefined();
  });

  // P4
  it("P4: visible when page is selected", () => {
    initCardboxAnkiExportCommands();
    const visible = getVisibleCommands();
    expect(visible.find((c) => c.id === "cardbox.exportAnki")).toBeDefined();
  });

  // P5
  it("P5a: searchable by keyword 'anki'", () => {
    initCardboxAnkiExportCommands();
    const visible = getVisibleCommands("anki");
    expect(visible.find((c) => c.id === "cardbox.exportAnki")).toBeDefined();
  });

  it("P5b: searchable by keyword 'apkg'", () => {
    initCardboxAnkiExportCommands();
    const visible = getVisibleCommands("apkg");
    expect(visible.find((c) => c.id === "cardbox.exportAnki")).toBeDefined();
  });

  it("P5c: searchable by keyword 'export'", () => {
    initCardboxAnkiExportCommands();
    const visible = getVisibleCommands("export");
    expect(visible.find((c) => c.id === "cardbox.exportAnki")).toBeDefined();
  });

  it("P5d: searchable by keyword 'cardbox'", () => {
    initCardboxAnkiExportCommands();
    const visible = getVisibleCommands("cardbox");
    expect(visible.find((c) => c.id === "cardbox.exportAnki")).toBeDefined();
  });

  // P6
  it("P6: action calls exportCardboxToAnki with currentPagePath", async () => {
    initCardboxAnkiExportCommands();
    const cmd = getAllCommands().find((c) => c.id === "cardbox.exportAnki")!;
    cmd.action();
    await vi.waitFor(() => {
      expect(mockExportCardboxToAnki).toHaveBeenCalledWith("hello.md");
    });
  });
});
