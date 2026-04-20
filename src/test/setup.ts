import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import { resetInvokeMock, resetListenMock } from "./tauri-mock";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
  emit: vi.fn(),
  once: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

beforeEach(() => {
  resetInvokeMock();
  resetListenMock();
  localStorage.clear();
});
