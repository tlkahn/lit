import { useEffect } from "react";
import { usePreferencesStore } from "../stores/preferences";

export type Theme = "light" | "dark";

async function syncNativeTitleBar(theme: Theme): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(theme);
  } catch {
    // Tauri API unavailable (tests, plain browser dev)
  }
}

export function useTheme() {
  const darkMode = usePreferencesStore((s) => s.darkMode);
  const theme: Theme = darkMode ? "dark" : "light";

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark", "theme-dark");
      root.classList.remove("theme-light");
    } else {
      root.classList.remove("dark", "theme-dark");
      root.classList.add("theme-light");
    }
    syncNativeTitleBar(theme);
  }, [theme]);

  return { theme } as const;
}
