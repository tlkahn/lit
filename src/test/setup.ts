import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import { resetInvokeMock } from "./tauri-mock";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

beforeEach(() => {
  resetInvokeMock();
  localStorage.clear();
});
