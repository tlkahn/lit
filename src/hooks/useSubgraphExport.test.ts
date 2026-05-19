import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { mockInvoke } from "../test/tauri-mock";
import { save } from "@tauri-apps/plugin-dialog";
import { useSubgraphExport } from "./useSubgraphExport";

const mockedSave = save as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke((cmd) => {
    if (cmd === "export_subgraph") return { pages_exported: 2, zip_path: "/out/export.zip" };
    throw new Error(`Unknown command: ${cmd}`);
  });
});

describe("useSubgraphExport", () => {
  it("pickerOpen is false initially", () => {
    const { result } = renderHook(() => useSubgraphExport());
    expect(result.current.pickerOpen).toBe(false);
  });

  it("requestExport sets pickerOpen to true", () => {
    const { result } = renderHook(() => useSubgraphExport());
    act(() => { result.current.requestExport("page.md"); });
    expect(result.current.pickerOpen).toBe(true);
  });

  it("handlePickerCancel sets pickerOpen to false", () => {
    const { result } = renderHook(() => useSubgraphExport());
    act(() => { result.current.requestExport("page.md"); });
    expect(result.current.pickerOpen).toBe(true);
    act(() => { result.current.handlePickerCancel(); });
    expect(result.current.pickerOpen).toBe(false);
  });
});

describe("useSubgraphExport IPC flow", () => {
  it("handlePickerExport opens save dialog and calls exportSubgraph", async () => {
    mockedSave.mockResolvedValue("/out/export.zip");
    const { result } = renderHook(() => useSubgraphExport());
    act(() => { result.current.requestExport("page.md"); });
    await act(async () => { await result.current.handlePickerExport(2); });

    expect(mockedSave).toHaveBeenCalledWith({
      defaultPath: "export.zip",
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    expect(result.current.pickerOpen).toBe(false);
  });

  it("does nothing when save dialog returns null", async () => {
    mockedSave.mockResolvedValue(null);
    const invokedCmds: string[] = [];
    mockInvoke((cmd) => {
      invokedCmds.push(cmd);
      return { pages_exported: 0, zip_path: "" };
    });

    const { result } = renderHook(() => useSubgraphExport());
    act(() => { result.current.requestExport("page.md"); });
    await act(async () => { await result.current.handlePickerExport(1); });

    expect(invokedCmds).not.toContain("export_subgraph");
  });

  it("pickerOpen is false after export", async () => {
    mockedSave.mockResolvedValue("/out/export.zip");
    const { result } = renderHook(() => useSubgraphExport());
    act(() => { result.current.requestExport("page.md"); });
    await act(async () => { await result.current.handlePickerExport(1); });
    expect(result.current.pickerOpen).toBe(false);
  });
});
