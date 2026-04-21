import { useState } from "react";
import { useThemeStore } from "../stores/theme";
import { getThemesDirectory } from "../lib/ipc";

export function ThemeChooser() {
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const availableThemes = useThemeStore((s) => s.availableThemes);
  const activateTheme = useThemeStore((s) => s.activateTheme);
  const deactivateTheme = useThemeStore((s) => s.deactivateTheme);
  const [open, setOpen] = useState(false);

  const handleOpenFolder = async () => {
    try {
      const dir = await getThemesDirectory();
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(dir);
    } catch {
      // opener plugin unavailable
    }
  };

  if (availableThemes.length === 0 && !open) {
    return null;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded px-2 py-1 text-sm text-text-muted hover:bg-bg-hover"
        aria-label="Choose theme"
      >
        Theme
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-48 rounded border border-border bg-bg-primary shadow-lg">
          <button
            onClick={() => {
              deactivateTheme();
              setOpen(false);
            }}
            className={`block w-full px-4 py-2 text-left text-sm ${
              !activeThemeId ? "bg-nav-active-bg text-nav-active-text" : "text-text-normal hover:bg-bg-hover"
            }`}
          >
            Default
          </button>
          {availableThemes.map((t) => (
            <button
              key={t.directory_name}
              onClick={() => {
                activateTheme(t.directory_name);
                setOpen(false);
              }}
              className={`block w-full px-4 py-2 text-left text-sm ${
                activeThemeId === t.directory_name
                  ? "bg-nav-active-bg text-nav-active-text"
                  : "text-text-normal hover:bg-bg-hover"
              }`}
            >
              <span>{t.name}</span>
              <span className="ml-2 text-text-faint">{t.author}</span>
            </button>
          ))}
          <div className="border-t border-border">
            <button
              onClick={handleOpenFolder}
              className="block w-full px-4 py-2 text-left text-sm text-text-muted hover:bg-bg-hover"
            >
              Open themes folder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
