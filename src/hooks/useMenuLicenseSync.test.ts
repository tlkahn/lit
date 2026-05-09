import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMenuLicenseSync } from "./useMenuLicenseSync";
import { useLicenseStore } from "../stores/license";

const mockItems: Record<string, { setEnabled: ReturnType<typeof vi.fn> }> = {
  buy_license: { setEnabled: vi.fn(() => Promise.resolve()) },
  enter_license_key: { setEnabled: vi.fn(() => Promise.resolve()) },
  license_info: { setEnabled: vi.fn(() => Promise.resolve()) },
};

const mockMenu = {
  get: vi.fn((id: string) => Promise.resolve(mockItems[id] ?? null)),
};

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: {
    default: vi.fn(() => Promise.resolve(mockMenu)),
  },
}));

import { Menu } from "@tauri-apps/api/menu";

describe("useMenuLicenseSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLicenseStore.setState({
      state: "unknown",
      daysRemaining: null,
      licensedTo: null,
      loading: true,
      error: null,
    });
  });

  it("does not call Menu.default when state is unknown", async () => {
    renderHook(() => useMenuLicenseSync());
    await new Promise((r) => setTimeout(r, 10));
    expect(Menu.default).not.toHaveBeenCalled();
  });

  it("enables buy_license and enter_license_key, disables license_info when trial", async () => {
    useLicenseStore.setState({ state: "trial", loading: false });
    renderHook(() => useMenuLicenseSync());
    await new Promise((r) => setTimeout(r, 10));
    expect(mockItems["buy_license"]!.setEnabled).toHaveBeenCalledWith(true);
    expect(mockItems["enter_license_key"]!.setEnabled).toHaveBeenCalledWith(true);
    expect(mockItems["license_info"]!.setEnabled).toHaveBeenCalledWith(false);
  });

  it("disables buy_license and enter_license_key, enables license_info when licensed", async () => {
    useLicenseStore.setState({ state: "licensed", loading: false });
    renderHook(() => useMenuLicenseSync());
    await new Promise((r) => setTimeout(r, 10));
    expect(mockItems["buy_license"]!.setEnabled).toHaveBeenCalledWith(false);
    expect(mockItems["enter_license_key"]!.setEnabled).toHaveBeenCalledWith(false);
    expect(mockItems["license_info"]!.setEnabled).toHaveBeenCalledWith(true);
  });
});
