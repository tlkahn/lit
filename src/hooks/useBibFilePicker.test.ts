import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBibFilePicker } from "./useBibFilePicker";
import { mockInvoke } from "../test/tauri-mock";

beforeEach(() => {
  mockInvoke((cmd) => {
    if (cmd === "list_bib_files") return ["/ws/refs.bib"];
    throw new Error(`Unknown command: ${cmd}`);
  });
});

describe("useBibFilePicker", () => {
  it("returns empty state when not open", () => {
    const { result } = renderHook(() => useBibFilePicker("/ws", false));
    expect(result.current.bibFiles).toEqual([]);
    expect(result.current.selectedBibFile).toBe("");
    expect(result.current.newBibPath).toBe("refs.bib");
  });

  it("loads bib files when open", async () => {
    const { result } = renderHook(() => useBibFilePicker("/ws", true));
    await waitFor(() => {
      expect(result.current.bibFiles).toEqual(["/ws/refs.bib"]);
      expect(result.current.selectedBibFile).toBe("/ws/refs.bib");
    });
  });

  it("falls back to __new__ when no bib files", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_bib_files") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useBibFilePicker("/ws", true));
    await waitFor(() => {
      expect(result.current.selectedBibFile).toBe("__new__");
    });
  });

  it("falls back to __new__ on error", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_bib_files") throw new Error("fail");
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useBibFilePicker("/ws", true));
    await waitFor(() => {
      expect(result.current.selectedBibFile).toBe("__new__");
    });
  });

  it("effectiveBibPath joins workspace + newBibPath when __new__", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_bib_files") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useBibFilePicker("/ws", true));
    await waitFor(() => {
      expect(result.current.selectedBibFile).toBe("__new__");
    });
    expect(result.current.effectiveBibPath).toBe("/ws/refs.bib");
  });

  it("effectiveBibPath returns selected file path when not __new__", async () => {
    const { result } = renderHook(() => useBibFilePicker("/ws", true));
    await waitFor(() => {
      expect(result.current.selectedBibFile).toBe("/ws/refs.bib");
    });
    expect(result.current.effectiveBibPath).toBe("/ws/refs.bib");
  });

  it("resets state on reopen", async () => {
    const { result, rerender } = renderHook(
      ({ open }) => useBibFilePicker("/ws", open),
      { initialProps: { open: true } },
    );

    await waitFor(() => {
      expect(result.current.selectedBibFile).toBe("/ws/refs.bib");
    });

    // Change selection
    act(() => {
      result.current.setSelectedBibFile("__new__");
    });
    expect(result.current.selectedBibFile).toBe("__new__");

    // Close
    rerender({ open: false });

    // Reopen
    rerender({ open: true });

    await waitFor(() => {
      expect(result.current.selectedBibFile).toBe("/ws/refs.bib");
    });
  });

  it("returns empty effectiveBibPath when workspacePath is null", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_bib_files") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useBibFilePicker(null, true));
    // workspacePath is null, so listBibFiles is not called, selectedBibFile stays ""
    expect(result.current.effectiveBibPath).toBe("");
  });
});
