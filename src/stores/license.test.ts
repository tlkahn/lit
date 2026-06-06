import { describe, it, expect, beforeEach, vi } from "vitest";
import { useLicenseStore } from "./license";

vi.mock("../lib/ipc", () => ({
  getLicenseStatus: vi.fn(),
  activateLicense: vi.fn(),
  checkOnlineValidation: vi.fn(),
}));

import { getLicenseStatus, activateLicense, checkOnlineValidation } from "../lib/ipc";

const mockedGetLicenseStatus = getLicenseStatus as ReturnType<typeof vi.fn>;
const mockedActivateLicense = activateLicense as ReturnType<typeof vi.fn>;
const mockedCheckOnlineValidation = checkOnlineValidation as ReturnType<typeof vi.fn>;


describe("license store", () => {
  beforeEach(() => {
    useLicenseStore.setState({
      state: "unknown",
      licensedTo: null,
      source: null,
      expiresAt: null,
      expiryDate: null,
      reason: null,
      loading: true,
      error: null,
    });
    vi.clearAllMocks();
  });

  it("initial state is 'unknown' with loading true", () => {
    const s = useLicenseStore.getState();
    expect(s.state).toBe("unknown");
    expect(s.loading).toBe(true);
  });

  it("fetchStatus sets unlicensed state from IPC", async () => {
    mockedGetLicenseStatus.mockResolvedValue({ state: "unlicensed" });
    mockedCheckOnlineValidation.mockResolvedValue({ action: "skipped", reason: "no_license" });
    await useLicenseStore.getState().fetchStatus();
    const s = useLicenseStore.getState();
    expect(s.state).toBe("unlicensed");
    expect(s.licensedTo).toBeNull();
    expect(s.loading).toBe(false);
  });

  it("fetchStatus sets licensed state", async () => {
    mockedGetLicenseStatus.mockResolvedValue({
      state: "licensed",
      licensed_to: "Alice",
      source: "direct",
      expires_at: 1735603200,
      expiry_date: "2024-12-31",
    });
    mockedCheckOnlineValidation.mockResolvedValue({ action: "valid" });
    await useLicenseStore.getState().fetchStatus();
    const s = useLicenseStore.getState();
    expect(s.state).toBe("licensed");
    expect(s.licensedTo).toBe("Alice");
    expect(s.source).toBe("direct");
    expect(s.expiresAt).toBe(1735603200);
    expect(s.expiryDate).toBe("2024-12-31");
    expect(s.loading).toBe(false);
  });

  it("fetchStatus sets license_expired state", async () => {
    mockedGetLicenseStatus.mockResolvedValue({
      state: "license_expired",
      licensed_to: "Bob",
      source: "direct",
      expires_at: 1735603200,
      expiry_date: "2024-12-31",
    });
    mockedCheckOnlineValidation.mockResolvedValue({ action: "skipped", reason: "not_due" });
    await useLicenseStore.getState().fetchStatus();
    const s = useLicenseStore.getState();
    expect(s.state).toBe("license_expired");
    expect(s.licensedTo).toBe("Bob");
    expect(s.expiryDate).toBe("2024-12-31");
  });

  it("activate calls activateLicense IPC and updates state", async () => {
    mockedActivateLicense.mockResolvedValue({ state: "licensed", licensed_to: "Bob" });
    const ok = await useLicenseStore.getState().activate("PEM-KEY");
    expect(ok).toBe(true);
    expect(mockedActivateLicense).toHaveBeenCalledWith("PEM-KEY");
    const s = useLicenseStore.getState();
    expect(s.state).toBe("licensed");
    expect(s.licensedTo).toBe("Bob");
  });

  it("activate sets error on IPC failure", async () => {
    mockedActivateLicense.mockRejectedValue(new Error("Invalid key"));
    const ok = await useLicenseStore.getState().activate("BAD-KEY");
    expect(ok).toBe(false);
    expect(useLicenseStore.getState().error).toBe("Invalid key");
  });

  it("activate clears previous error on success", async () => {
    useLicenseStore.setState({ error: "old error" });
    mockedActivateLicense.mockResolvedValue({ state: "licensed", licensed_to: "Eve" });
    await useLicenseStore.getState().activate("GOOD-KEY");
    expect(useLicenseStore.getState().error).toBeNull();
  });

  it("activate returns false and sets expired error when res.state is license_expired", async () => {
    mockedActivateLicense.mockResolvedValue({
      state: "license_expired",
      licensed_to: "Bob",
      expiry_date: "2024-12-31",
    });
    const ok = await useLicenseStore.getState().activate("EXPIRED-KEY");
    expect(ok).toBe(false);
    const s = useLicenseStore.getState();
    expect(s.state).toBe("license_expired");
    expect(s.expiryDate).toBe("2024-12-31");
    expect(s.error).toMatch(/expired/i);
  });

  it("activate returns false and sets error when res.state is unlicensed", async () => {
    mockedActivateLicense.mockResolvedValue({ state: "unlicensed" });
    const ok = await useLicenseStore.getState().activate("WEIRD-KEY");
    expect(ok).toBe(false);
    const s = useLicenseStore.getState();
    expect(s.state).toBe("unlicensed");
    expect(s.error).toBeTruthy();
    expect(typeof s.error).toBe("string");
  });

  it("clearError clears the error field", () => {
    useLicenseStore.setState({ error: "some error" });
    useLicenseStore.getState().clearError();
    expect(useLicenseStore.getState().error).toBeNull();
  });

  it("fetchStatus revoked stores reason from IPC response", async () => {
    mockedGetLicenseStatus.mockResolvedValue({ state: "revoked", reason: "refund" });
    mockedCheckOnlineValidation.mockResolvedValue({ action: "skipped", reason: "no_license" });
    await useLicenseStore.getState().fetchStatus();
    const s = useLicenseStore.getState();
    expect(s.state).toBe("revoked");
    expect(s.reason).toBe("refund");
  });

  it("fetchStatus revoked triggers re-fetch and sets revoked", async () => {
    mockedGetLicenseStatus
      .mockResolvedValueOnce({ state: "licensed", licensed_to: "Bob" })
      .mockResolvedValueOnce({ state: "revoked" });
    mockedCheckOnlineValidation.mockResolvedValue({ action: "revoked", reason: "refund" });
    await useLicenseStore.getState().fetchStatus();
    expect(useLicenseStore.getState().state).toBe("licensed");
    await vi.waitFor(() => {
      expect(useLicenseStore.getState().state).toBe("revoked");
    });
    expect(mockedGetLicenseStatus).toHaveBeenCalledTimes(2);
  });

  it("fetchStatus valid does not re-fetch", async () => {
    mockedGetLicenseStatus.mockResolvedValue({ state: "licensed", licensed_to: "Alice" });
    mockedCheckOnlineValidation.mockResolvedValue({ action: "valid" });
    await useLicenseStore.getState().fetchStatus();
    expect(mockedGetLicenseStatus).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(mockedGetLicenseStatus).toHaveBeenCalledTimes(1);
    });
    expect(useLicenseStore.getState().state).toBe("licensed");
  });

  it("fetchStatus skipped does not re-fetch", async () => {
    mockedGetLicenseStatus.mockResolvedValue({ state: "licensed", licensed_to: "Alice" });
    mockedCheckOnlineValidation.mockResolvedValue({ action: "skipped", reason: "not_due" });
    await useLicenseStore.getState().fetchStatus();
    expect(mockedGetLicenseStatus).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(mockedGetLicenseStatus).toHaveBeenCalledTimes(1);
    });
    expect(useLicenseStore.getState().state).toBe("licensed");
  });

  it("fetchStatus online check rejection is non-fatal", async () => {
    mockedGetLicenseStatus.mockResolvedValue({ state: "licensed", licensed_to: "Alice" });
    mockedCheckOnlineValidation.mockRejectedValue(new Error("IPC error"));
    await useLicenseStore.getState().fetchStatus();
    await vi.waitFor(() => {
      const s = useLicenseStore.getState();
      expect(s.state).toBe("licensed");
      expect(s.loading).toBe(false);
    });
  });

  it("fetchStatus IPC rejection clears loading and sets unlicensed with error", async () => {
    mockedGetLicenseStatus.mockRejectedValue(new Error("command not registered"));
    await useLicenseStore.getState().fetchStatus();
    const s = useLicenseStore.getState();
    expect(s.state).toBe("unlicensed");
    expect(s.loading).toBe(false);
    expect(s.error).toContain("command not registered");
  });

  it("fetchStatus never leaves loading true on initial fetch failure", async () => {
    mockedGetLicenseStatus.mockRejectedValue(new Error("backend panic"));
    await expect(useLicenseStore.getState().fetchStatus()).resolves.toBeUndefined();
    expect(useLicenseStore.getState().loading).toBe(false);
  });
});
