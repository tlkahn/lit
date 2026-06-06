import { describe, it, expect, beforeEach } from "vitest";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import {
  mockListen,
  mockWindowListen,
  emitMockEvent,
  emitWindowEvent,
  resetListenMock,
  resetWindowListenMock,
} from "./tauri-mock";

describe("tauri-mock window-scoped listen", () => {
  beforeEach(() => {
    resetListenMock();
    resetWindowListenMock();
  });

  it("mockWindowListen registers callback that emitWindowEvent can trigger", async () => {
    mockWindowListen();
    let received: unknown = null;
    const win = getCurrentWebviewWindow();
    await win.listen("test-event", (event: { payload: unknown }) => {
      received = event.payload;
    });
    emitWindowEvent("test-event", { data: 42 });
    expect(received).toEqual({ data: 42 });
  });

  it("emitWindowEvent does not trigger global listen callbacks", async () => {
    mockListen();
    mockWindowListen();
    let globalFired = false;
    await listen("test-event", () => {
      globalFired = true;
    });
    emitWindowEvent("test-event", {});
    expect(globalFired).toBe(false);
  });

  it("emitMockEvent does not trigger window-scoped listen callbacks", async () => {
    mockListen();
    mockWindowListen();
    let windowFired = false;
    const win = getCurrentWebviewWindow();
    await win.listen("test-event", () => {
      windowFired = true;
    });
    emitMockEvent("test-event", {});
    expect(windowFired).toBe(false);
  });
});
