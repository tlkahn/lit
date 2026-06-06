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
      licensedTo: null,
      source: null,
      expiresAt: null,
      expiryDate: null,
      loading: true,
      error: null,
    });
  });

  it("sets 'Lit' when licensed", async () => {
    useLicenseStore.setState({ state: "licensed", loading: false });
    renderHook(() => useLicenseTitle());
    await waitFor(() => {
      expect(mockSetTitle).toHaveBeenCalledWith("Lit");
    });
  });

  it("sets 'Lit' when unlicensed", async () => {
    useLicenseStore.setState({ state: "unlicensed", loading: false });
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
