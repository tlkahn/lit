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
      licensedTo: null,
      source: null,
      expiresAt: null,
      expiryDate: null,
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

  it("calls syncLicenseMenu with 'unlicensed' when state is unlicensed", async () => {
    useLicenseStore.setState({ state: "unlicensed", loading: false });
    renderHook(() => useMenuLicenseSync());
    await waitFor(() => {
      expect(syncLicenseMenu).toHaveBeenCalledWith("unlicensed");
    });
  });

  it("calls syncLicenseMenu with 'licensed' when state is licensed", async () => {
    useLicenseStore.setState({ state: "licensed", loading: false });
    renderHook(() => useMenuLicenseSync());
    await waitFor(() => {
      expect(syncLicenseMenu).toHaveBeenCalledWith("licensed");
    });
  });

  it("calls syncLicenseMenu with 'license_expired' when state is license_expired", async () => {
    useLicenseStore.setState({ state: "license_expired", loading: false });
    renderHook(() => useMenuLicenseSync());
    await waitFor(() => {
      expect(syncLicenseMenu).toHaveBeenCalledWith("license_expired");
    });
  });
});
