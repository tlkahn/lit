import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import { resetInvokeMock, resetListenMock } from "./tauri-mock";

globalThis.ResizeObserver = class {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    if (!(target instanceof HTMLElement) || !target.hasAttribute("data-virtual-scroll")) {
      return;
    }
    const h = target.clientHeight;
    const w = target.clientWidth;
    this.cb(
      [{
        target,
        contentRect: target.getBoundingClientRect(),
        borderBoxSize: [{ blockSize: h, inlineSize: w }],
      } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get() {
    return this._clientHeight ?? 5000;
  },
  set(v: number) {
    this._clientHeight = v;
  },
});

Object.defineProperty(HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get() {
    return this._clientWidth ?? 1000;
  },
  set(v: number) {
    this._clientWidth = v;
  },
});

if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = function () {};
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
  emit: vi.fn(),
  once: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    setTheme: vi.fn(() => Promise.resolve()),
  })),
}));

beforeEach(() => {
  resetInvokeMock();
  resetListenMock();
  localStorage.clear();
});
