import { vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

type InvokeHandler = (cmd: string, args?: Record<string, unknown>) => unknown;

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const mockedListen = listen as unknown as ReturnType<typeof vi.fn>;
const mockedDialogOpen = open as unknown as ReturnType<typeof vi.fn>;

export function mockInvoke(handler: InvokeHandler) {
  mockedInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) =>
    Promise.resolve(handler(cmd, args)),
  );
}

export function resetInvokeMock() {
  mockedInvoke.mockReset();
}

export type ListenCallback = (event: { payload: unknown }) => void;

const listenCallbacks = new Map<string, ListenCallback[]>();

export function mockListen() {
  mockedListen.mockImplementation((event: string, callback: ListenCallback) => {
    const callbacks = listenCallbacks.get(event) || [];
    callbacks.push(callback);
    listenCallbacks.set(event, callbacks);
    return Promise.resolve(() => {
      const cbs = listenCallbacks.get(event) || [];
      const idx = cbs.indexOf(callback);
      if (idx >= 0) cbs.splice(idx, 1);
    });
  });
}

export function emitMockEvent(event: string, payload: unknown) {
  const callbacks = listenCallbacks.get(event) || [];
  for (const cb of callbacks) {
    cb({ payload });
  }
}

export function resetListenMock() {
  listenCallbacks.clear();
  mockedListen.mockReset();
  mockedListen.mockImplementation(() => Promise.resolve(vi.fn()));
}

export function mockDialogOpen(result: string | null) {
  mockedDialogOpen.mockResolvedValue(result);
}

const windowListenCallbacks = new Map<string, ListenCallback[]>();

const mockedGetCurrentWebviewWindow = getCurrentWebviewWindow as unknown as ReturnType<typeof vi.fn>;

export function mockWindowListen() {
  const mockListenFn = vi.fn((event: string, callback: ListenCallback) => {
    const callbacks = windowListenCallbacks.get(event) || [];
    callbacks.push(callback);
    windowListenCallbacks.set(event, callbacks);
    return Promise.resolve(() => {
      const cbs = windowListenCallbacks.get(event) || [];
      const idx = cbs.indexOf(callback);
      if (idx >= 0) cbs.splice(idx, 1);
    });
  });
  mockedGetCurrentWebviewWindow.mockReturnValue({
    listen: mockListenFn,
  });
}

export function emitWindowEvent(event: string, payload: unknown) {
  const callbacks = windowListenCallbacks.get(event) || [];
  for (const cb of callbacks) {
    cb({ payload });
  }
}

export function resetWindowListenMock() {
  windowListenCallbacks.clear();
  mockedGetCurrentWebviewWindow.mockReturnValue({
    listen: vi.fn(() => Promise.resolve(vi.fn())),
  });
}
