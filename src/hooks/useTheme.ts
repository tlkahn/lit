import { useEffect, useSyncExternalStore } from "react";
import { usePreferencesStore } from "../stores/preferences";

export type Theme = "light" | "dark";

function getMql(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return null;
  return window.matchMedia("(prefers-color-scheme: dark)");
}

function getSystemDark(): boolean {
  return getMql()?.matches ?? false;
}

function subscribeSystemTheme(cb: () => void): () => void {
  const mql = getMql();
  mql?.addEventListener("change", cb);
  return () => mql?.removeEventListener("change", cb);
}

async function syncNativeTitleBar(theme: Theme | null): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(theme);
  } catch {
    // Tauri API unavailable (tests, plain browser dev)
  }
}

export function useTheme() {
  const darkModePref = usePreferencesStore((s) => s.darkMode);
  const systemDark = useSyncExternalStore(subscribeSystemTheme, getSystemDark);

  const theme: Theme =
    darkModePref === "auto"
      ? systemDark
        ? "dark"
        : "light"
      : darkModePref === "dark"
        ? "dark"
        : "light";

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark", "theme-dark");
      root.classList.remove("theme-light");
    } else {
      root.classList.remove("dark", "theme-dark");
      root.classList.add("theme-light");
    }
    syncNativeTitleBar(darkModePref === "auto" ? null : theme);
  }, [theme, darkModePref]);

  return { theme } as const;
}
