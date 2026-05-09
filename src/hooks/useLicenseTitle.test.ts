import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLicenseTitle } from "./useLicenseTitle";
import { useLicenseStore } from "../stores/license";

describe("useLicenseTitle", () => {
  let mockSetTitle: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSetTitle = vi.fn(() => Promise.resolve());
    vi.mocked(getCurrentWindow).mockReturnValue({
      setTitle: mockSetTitle,
    } as unknown as ReturnType<typeof getCurrentWindow>);
    useLicenseStore.setState({
      state: "unknown",
      daysRemaining: null,
      licensedTo: null,
      loading: true,
      error: null,
    });
  });

  it("sets 'Lit (N days left in trial)' when trial", async () => {
    useLicenseStore.setState({ state: "trial", daysRemaining: 10, loading: false });
    renderHook(() => useLicenseTitle());
    await waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith("Lit (10 days left in trial)");
    });
  });

  it("singular 'day' when daysRemaining is 1", async () => {
    useLicenseStore.setState({ state: "trial", daysRemaining: 1, loading: false });
    renderHook(() => useLicenseTitle());
    await waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith("Lit (1 day left in trial)");
    });
  });

  it("sets 'Lit (N days left in trial)' when expiring_soon", async () => {
    useLicenseStore.setState({ state: "expiring_soon", daysRemaining: 2, loading: false });
    renderHook(() => useLicenseTitle());
    await waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith("Lit (2 days left in trial)");
    });
  });

  it("sets 'Lit' when licensed", async () => {
    useLicenseStore.setState({ state: "licensed", loading: false });
    renderHook(() => useLicenseTitle());
    await waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith("Lit");
    });
  });

  it("does not call setTitle when state is 'unknown'", () => {
    useLicenseStore.setState({ state: "unknown", loading: true });
    renderHook(() => useLicenseTitle());
    expect(mockSetTitle).not.toHaveBeenCalled();
  });
});
