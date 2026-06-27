import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTheme } from "./useTheme";
import { usePreferencesStore } from "../stores/preferences";

let matchMediaMatches = false;
const matchMediaListeners: Array<() => void> = [];

beforeEach(() => {
  matchMediaMatches = false;
  matchMediaListeners.length = 0;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: matchMediaMatches,
      media: query,
      addEventListener: (_: string, cb: () => void) => matchMediaListeners.push(cb),
      removeEventListener: (_: string, cb: () => void) => {
        const i = matchMediaListeners.indexOf(cb);
        if (i >= 0) matchMediaListeners.splice(i, 1);
      },
    })),
  });
});

function fireSystemThemeChange(dark: boolean) {
  matchMediaMatches = dark;
  matchMediaListeners.forEach((cb) => cb());
}

describe("useTheme", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark", "theme-dark", "theme-light");
    usePreferencesStore.setState({ darkMode: "auto", sidebarLocation: "left", loaded: true });
  });

  it("applies light theme when darkMode is 'light'", () => {
    usePreferencesStore.setState({ darkMode: "light" });
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("theme-light")).toBe(true);
  });

  it("applies dark theme when darkMode is 'dark'", () => {
    usePreferencesStore.setState({ darkMode: "dark" });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-dark")).toBe(true);
  });

  it("follows system theme when darkMode is 'auto' (light system)", () => {
    matchMediaMatches = false;
    usePreferencesStore.setState({ darkMode: "auto" });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("theme-light")).toBe(true);
  });

  it("follows system theme when darkMode is 'auto' (dark system)", () => {
    matchMediaMatches = true;
    usePreferencesStore.setState({ darkMode: "auto" });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("reacts to system theme changes in auto mode", () => {
    matchMediaMatches = false;
    usePreferencesStore.setState({ darkMode: "auto" });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");

    act(() => fireSystemThemeChange(true));
    expect(result.current.theme).toBe("dark");

    act(() => fireSystemThemeChange(false));
    expect(result.current.theme).toBe("light");
  });

  it("ignores system theme changes when explicitly set to dark", () => {
    matchMediaMatches = false;
    usePreferencesStore.setState({ darkMode: "dark" });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");

    act(() => fireSystemThemeChange(false));
    expect(result.current.theme).toBe("dark");
  });

  it("reacts to preferences store changes", () => {
    usePreferencesStore.setState({ darkMode: "light" });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");

    act(() => usePreferencesStore.setState({ darkMode: "dark" }));
    expect(result.current.theme).toBe("dark");
  });

  it("calls setTheme on the native window", async () => {
    usePreferencesStore.setState({ darkMode: "light" });
    const mockSetTheme = vi.fn(() => Promise.resolve());
    vi.mocked(getCurrentWindow).mockReturnValue({
      setTheme: mockSetTheme,
    } as unknown as ReturnType<typeof getCurrentWindow>);

    renderHook(() => useTheme());

    await waitFor(() => {
      expect(mockSetTheme).toHaveBeenCalledWith("light");
    });
  });

  it("calls setTheme(null) when darkMode is auto", async () => {
    matchMediaMatches = false;
    usePreferencesStore.setState({ darkMode: "auto" });
    const mockSetTheme = vi.fn(() => Promise.resolve());
    vi.mocked(getCurrentWindow).mockReturnValue({
      setTheme: mockSetTheme,
    } as unknown as ReturnType<typeof getCurrentWindow>);

    renderHook(() => useTheme());

    await waitFor(() => {
      expect(mockSetTheme).toHaveBeenCalledWith(null);
    });
  });

  it("calls setTheme with explicit theme when darkMode is dark", async () => {
    usePreferencesStore.setState({ darkMode: "dark" });
    const mockSetTheme = vi.fn(() => Promise.resolve());
    vi.mocked(getCurrentWindow).mockReturnValue({
      setTheme: mockSetTheme,
    } as unknown as ReturnType<typeof getCurrentWindow>);

    renderHook(() => useTheme());

    await waitFor(() => {
      expect(mockSetTheme).toHaveBeenCalledWith("dark");
    });
  });

  it("switches from explicit to auto calls setTheme(null)", async () => {
    matchMediaMatches = true;
    usePreferencesStore.setState({ darkMode: "dark" });
    const mockSetTheme = vi.fn(() => Promise.resolve());
    vi.mocked(getCurrentWindow).mockReturnValue({
      setTheme: mockSetTheme,
    } as unknown as ReturnType<typeof getCurrentWindow>);

    const { result } = renderHook(() => useTheme());
    await waitFor(() => {
      expect(mockSetTheme).toHaveBeenCalledWith("dark");
    });

    mockSetTheme.mockClear();
    act(() => usePreferencesStore.setState({ darkMode: "auto" }));

    expect(result.current.theme).toBe("dark");
    await waitFor(() => {
      expect(mockSetTheme).toHaveBeenCalledWith(null);
    });
  });
});
