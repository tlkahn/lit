import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import { resetInvokeMock, resetListenMock, resetWindowListenMock } from "./tauri-mock";

globalThis.ResizeObserver = class {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    if (!(target instanceof HTMLElement) || !(target.hasAttribute("data-virtual-scroll") || target.hasAttribute("data-masonry-content") || target.hasAttribute("data-bib-actions"))) {
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

Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get() {
    if (this.hasAttribute?.("data-index")) return 28;
    return 0;
  },
});

if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = function () {};
}

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as DOMRectList;
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
  save: vi.fn(),
  ask: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
  openPath: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    setTheme: vi.fn(() => Promise.resolve()),
    setTitle: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  })),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    onDragDropEvent: vi.fn(() => Promise.resolve(vi.fn())),
  })),
}));

beforeEach(() => {
  resetInvokeMock();
  resetListenMock();
  resetWindowListenMock();
  localStorage.clear();
});
