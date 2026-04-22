import { useState, useRef, useEffect } from "react";
import { useThemeStore } from "../stores/theme";
import { getThemesDirectory } from "../lib/ipc";

export function ThemeChooser() {
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const availableThemes = useThemeStore((s) => s.availableThemes);
  const activateTheme = useThemeStore((s) => s.activateTheme);
  const deactivateTheme = useThemeStore((s) => s.deactivateTheme);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

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
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded px-2 py-1 text-sm text-text-muted hover:bg-bg-hover"
        aria-label="Choose theme"
      >
        Theme
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-48 select-none rounded border border-border bg-bg-primary shadow-lg">
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
              {t.name}
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
