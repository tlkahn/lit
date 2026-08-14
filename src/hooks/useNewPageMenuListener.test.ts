import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useNewPageMenuListener } from "./useNewPageMenuListener";
import { createUntitledPage } from "../lib/newPage";

vi.mock("../lib/newPage", () => ({ createUntitledPage: vi.fn() }));

type ListenCallback = (event: { payload: unknown }) => void;

const mockListen = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    listen: mockListen,
    onDragDropEvent: vi.fn(() => Promise.resolve(vi.fn())),
  })),
}));

describe("useNewPageMenuListener", () => {
  let captured: ListenCallback | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    captured = null;
    mockListen.mockReset();
    mockListen.mockImplementation((_event: string, callback: ListenCallback) => {
      captured = callback;
      return Promise.resolve(vi.fn());
    });
  });

  it("listens for menu://new-page on the current webview window", async () => {
    renderHook(() => useNewPageMenuListener());
    await waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith("menu://new-page", expect.any(Function));
    });
  });

  it("calls createUntitledPage when the menu://new-page event fires", async () => {
    renderHook(() => useNewPageMenuListener());
    await waitFor(() => expect(captured).toBeTruthy());
    captured!({ payload: {} });
    expect(createUntitledPage).toHaveBeenCalledOnce();
  });

  it("tears down the listener on unmount", async () => {
    const unlisten = vi.fn();
    mockListen.mockImplementation((_event: string, callback: ListenCallback) => {
      captured = callback;
      return Promise.resolve(unlisten);
    });
    const { unmount } = renderHook(() => useNewPageMenuListener());
    await waitFor(() => expect(captured).toBeTruthy());
    unmount();
    await waitFor(() => expect(unlisten).toHaveBeenCalled());
  });
});
