import { vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

type InvokeHandler = (cmd: string, args?: Record<string, unknown>) => unknown;

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

export function mockInvoke(handler: InvokeHandler) {
  mockedInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) =>
    Promise.resolve(handler(cmd, args)),
  );
}

export function resetInvokeMock() {
  mockedInvoke.mockReset();
}
