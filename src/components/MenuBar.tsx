import { useState, useRef, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useThemeStore } from "../stores/theme";
import { openWorkspaceWindow, getThemesDirectory } from "../lib/ipc";
import type { Theme } from "../hooks/useTheme";

interface MenuBarProps {
  theme: Theme;
  toggleTheme: () => void;
  position: "left" | "right";
  togglePosition: () => void;
}

export function MenuBar({ theme, toggleTheme, position, togglePosition }: MenuBarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [hoverMode, setHoverMode] = useState(false);
  const [themeSubOpen, setThemeSubOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const availableThemes = useThemeStore((s) => s.availableThemes);
  const activateTheme = useThemeStore((s) => s.activateTheme);
  const deactivateTheme = useThemeStore((s) => s.deactivateTheme);

  useEffect(() => {
    if (!openMenuId) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
        setHoverMode(false);
        setThemeSubOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenuId(null);
        setHoverMode(false);
        setThemeSubOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenuId]);

  const handleLabelClick = (id: string) => {
    setThemeSubOpen(false);
    if (openMenuId === id) {
      setOpenMenuId(null);
      setHoverMode(false);
    } else {
      setOpenMenuId(id);
      setHoverMode(true);
    }
  };

  const handleLabelEnter = (id: string) => {
    if (hoverMode && openMenuId !== id) {
      setThemeSubOpen(false);
      setOpenMenuId(id);
    }
  };

  const closeAll = () => {
    setOpenMenuId(null);
    setHoverMode(false);
    setThemeSubOpen(false);
  };

  const handleOpenWorkspace = async () => {
    closeAll();
    const selected = await open({ directory: true });
    if (selected) {
      await openWorkspaceWindow(selected);
    }
  };

  const handleOpenThemesFolder = async () => {
    closeAll();
    try {
      const dir = await getThemesDirectory();
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(dir);
    } catch {
      // plugin unavailable
    }
  };

  const labelClass = (id: string) =>
    `rounded px-3 py-1 text-sm text-text-normal ${openMenuId === id ? "bg-bg-hover" : "hover:bg-bg-hover"}`;

  const itemClass = "w-full px-4 py-1.5 text-left text-sm text-text-normal hover:bg-bg-hover";

  return (
    <div ref={barRef} className="flex h-8 items-center border-b border-border bg-bg-primary-alt px-1">
      <div className="relative">
        <button
          onClick={() => handleLabelClick("file")}
          onMouseEnter={() => handleLabelEnter("file")}
          className={labelClass("file")}
        >
          File
        </button>
        {openMenuId === "file" && (
          <div className="absolute left-0 top-full z-20 min-w-48 rounded border border-border bg-bg-primary py-1 shadow-lg">
            <button onClick={handleOpenWorkspace} className={itemClass}>
              Open Another Workspace
            </button>
          </div>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => handleLabelClick("view")}
          onMouseEnter={() => handleLabelEnter("view")}
          className={labelClass("view")}
        >
          View
        </button>
        {openMenuId === "view" && (
          <div className="absolute left-0 top-full z-20 min-w-48 rounded border border-border bg-bg-primary py-1 shadow-lg">
            <div
              className="relative"
              onMouseEnter={() => setThemeSubOpen(true)}
              onMouseLeave={() => setThemeSubOpen(false)}
            >
              <button className={`${itemClass} flex items-center justify-between`}>
                <span>Theme</span>
                <span className="ml-4 text-text-faint">&#9656;</span>
              </button>
              {themeSubOpen && (
                <div className="absolute left-full top-0 z-30 min-w-48 rounded border border-border bg-bg-primary py-1 shadow-lg">
                  <button
                    onClick={() => { deactivateTheme(); closeAll(); }}
                    className={itemClass}
                  >
                    <span className="inline-block w-5">{!activeThemeId ? "✓" : ""}</span>
                    Default
                  </button>
                  {availableThemes.map((t) => (
                    <button
                      key={t.directory_name}
                      onClick={() => { activateTheme(t.directory_name); closeAll(); }}
                      className={itemClass}
                    >
                      <span className="inline-block w-5">{activeThemeId === t.directory_name ? "✓" : ""}</span>
                      {t.name}
                    </button>
                  ))}
                  <div className="my-1 border-t border-border" />
                  <button onClick={handleOpenThemesFolder} className={itemClass}>
                    Open themes folder
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => { toggleTheme(); closeAll(); }}
              className={itemClass}
            >
              <span className="inline-block w-5">{theme === "dark" ? "✓" : ""}</span>
              Dark Mode
            </button>

            <div className="my-1 border-t border-border" />

            <button
              onClick={() => { if (position !== "left") togglePosition(); closeAll(); }}
              className={itemClass}
            >
              <span className="inline-block w-5">{position === "left" ? "✓" : ""}</span>
              Sidebar Left
            </button>
            <button
              onClick={() => { if (position !== "right") togglePosition(); closeAll(); }}
              className={itemClass}
            >
              <span className="inline-block w-5">{position === "right" ? "✓" : ""}</span>
              Sidebar Right
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
