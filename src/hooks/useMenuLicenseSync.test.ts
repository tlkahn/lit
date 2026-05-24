import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useMenuLicenseSync } from "./useMenuLicenseSync";
import { useLicenseStore } from "../stores/license";
import { syncLicenseMenu } from "../lib/ipc";

vi.mock("../lib/ipc", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/ipc")>();
  return {
    ...mod,
    syncLicenseMenu: vi.fn(() => Promise.resolve()),
  };
});

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

  it("does not call syncLicenseMenu when state is unknown", async () => {
    renderHook(() => useMenuLicenseSync());
    await waitFor(() => {
      expect(syncLicenseMenu).not.toHaveBeenCalled();
    });
  });

  it("calls syncLicenseMenu with 'trial' when state is trial", async () => {
    useLicenseStore.setState({ state: "trial", loading: false });
    renderHook(() => useMenuLicenseSync());
    await waitFor(() => {
      expect(syncLicenseMenu).toHaveBeenCalledWith("trial");
    });
  });

  it("calls syncLicenseMenu with 'licensed' when state is licensed", async () => {
    useLicenseStore.setState({ state: "licensed", loading: false });
    renderHook(() => useMenuLicenseSync());
    await waitFor(() => {
      expect(syncLicenseMenu).toHaveBeenCalledWith("licensed");
    });
  });
});
