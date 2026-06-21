import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { usePreferencesStore } from "../stores/preferences";
import { ensureSidebarVisible } from "./sidebarVisibility";

describe("ensureSidebarVisible", () => {
  beforeEach(() => {
    usePreferencesStore.setState({ sidebarVisible: false });
    vi.mocked(invoke).mockReset();
  });

  it("sets sidebarVisible in preferences store", () => {
    expect(usePreferencesStore.getState().sidebarVisible).toBe(false);

    ensureSidebarVisible();

    expect(usePreferencesStore.getState().sidebarVisible).toBe(true);
  });

  it("persists via setPreference IPC", () => {
    ensureSidebarVisible();

    expect(invoke).toHaveBeenCalledWith("set_preference", {
      key: "workbench.sideBar.visible",
      value: true,
    });
  });

  it("does not throw on IPC rejection (catch is attached)", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("IPC unavailable"));

    // Should not throw synchronously
    expect(() => ensureSidebarVisible()).not.toThrow();

    // Wait a tick for the rejection to settle without an unhandled rejection
    await new Promise((r) => setTimeout(r, 0));
  });
});
