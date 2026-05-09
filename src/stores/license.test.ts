import { describe, it, expect, beforeEach, vi } from "vitest";
import { useLicenseStore } from "./license";

vi.mock("../lib/ipc", () => ({
  getLicenseStatus: vi.fn(),
  activateLicense: vi.fn(),
}));

import { getLicenseStatus, activateLicense } from "../lib/ipc";

const mockedGetLicenseStatus = getLicenseStatus as ReturnType<typeof vi.fn>;
const mockedActivateLicense = activateLicense as ReturnType<typeof vi.fn>;

describe("license store", () => {
  beforeEach(() => {
    useLicenseStore.setState({
      state: "unknown",
      daysRemaining: null,
      licensedTo: null,
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

  it("fetchStatus sets trial state from IPC", async () => {
    mockedGetLicenseStatus.mockResolvedValue({ state: "trial", days_remaining: 12 });
    await useLicenseStore.getState().fetchStatus();
    const s = useLicenseStore.getState();
    expect(s.state).toBe("trial");
    expect(s.daysRemaining).toBe(12);
    expect(s.loading).toBe(false);
  });

  it("fetchStatus sets licensed state", async () => {
    mockedGetLicenseStatus.mockResolvedValue({ state: "licensed", licensed_to: "Alice" });
    await useLicenseStore.getState().fetchStatus();
    const s = useLicenseStore.getState();
    expect(s.state).toBe("licensed");
    expect(s.licensedTo).toBe("Alice");
    expect(s.daysRemaining).toBeNull();
    expect(s.loading).toBe(false);
  });

  it("fetchStatus sets expiring_soon state", async () => {
    mockedGetLicenseStatus.mockResolvedValue({ state: "expiring_soon", days_remaining: 2 });
    await useLicenseStore.getState().fetchStatus();
    const s = useLicenseStore.getState();
    expect(s.state).toBe("expiring_soon");
    expect(s.daysRemaining).toBe(2);
  });

  it("fetchStatus sets expired state", async () => {
    mockedGetLicenseStatus.mockResolvedValue({ state: "expired", days_remaining: 0 });
    await useLicenseStore.getState().fetchStatus();
    const s = useLicenseStore.getState();
    expect(s.state).toBe("expired");
    expect(s.daysRemaining).toBe(0);
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

  it("clearError clears the error field", () => {
    useLicenseStore.setState({ error: "some error" });
    useLicenseStore.getState().clearError();
    expect(useLicenseStore.getState().error).toBeNull();
  });
});
