import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTheme } from "./useTheme";
import { usePreferencesStore } from "../stores/preferences";

describe("useTheme", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark", "theme-dark", "theme-light");
    usePreferencesStore.setState({ darkMode: false, colorTheme: null, sidebarLocation: "left", loaded: true });
  });

  it("applies light theme when darkMode is false", () => {
    usePreferencesStore.setState({ darkMode: false });
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("theme-light")).toBe(true);
  });

  it("applies dark theme when darkMode is true", () => {
    usePreferencesStore.setState({ darkMode: true });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-dark")).toBe(true);
  });

  it("reacts to preferences store changes", () => {
    usePreferencesStore.setState({ darkMode: false });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");

    act(() => usePreferencesStore.setState({ darkMode: true }));
    expect(result.current.theme).toBe("dark");
  });

  it("calls setTheme on the native window", async () => {
    usePreferencesStore.setState({ darkMode: false });
    const mockSetTheme = vi.fn(() => Promise.resolve());
    vi.mocked(getCurrentWindow).mockReturnValue({
      setTheme: mockSetTheme,
    } as unknown as ReturnType<typeof getCurrentWindow>);

    renderHook(() => useTheme());

    await waitFor(() => {
      expect(mockSetTheme).toHaveBeenCalledWith("light");
    });
  });
});
