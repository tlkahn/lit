import { describe, it, expect, vi } from "vitest";
import {
  mockListen,
  emitMockEvent,
  mockWindowListen,
  emitWindowEvent,
  resetListenMock,
  resetWindowListenMock,
} from "./tauri-mock";

describe("tauri-mock infrastructure", () => {
  beforeEach(() => {
    resetListenMock();
    resetWindowListenMock();
  });

  it("mockWindowListen + emitWindowEvent fires correctly", async () => {
    mockWindowListen();
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = getCurrentWebviewWindow();
    const handler = vi.fn();
    await win.listen("test-event", handler);

    emitWindowEvent("test-event", { value: 42 });

    expect(handler).toHaveBeenCalledWith({ payload: { value: 42 } });
  });

  it("emitWindowEvent does NOT trigger global listen callbacks", async () => {
    mockListen();
    mockWindowListen();
    const { listen } = await import("@tauri-apps/api/event");
    const globalHandler = vi.fn();
    await listen("shared-event", globalHandler);

    emitWindowEvent("shared-event", { value: 1 });

    expect(globalHandler).not.toHaveBeenCalled();
  });

  it("emitMockEvent does NOT trigger window-scoped callbacks", async () => {
    mockListen();
    mockWindowListen();
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = getCurrentWebviewWindow();
    const windowHandler = vi.fn();
    await win.listen("shared-event", windowHandler);

    emitMockEvent("shared-event", { value: 1 });

    expect(windowHandler).not.toHaveBeenCalled();
  });
});
