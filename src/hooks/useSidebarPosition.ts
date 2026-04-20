import { useState, useCallback } from "react";

type SidebarPosition = "left" | "right";

const STORAGE_KEY = "lit-sidebar-position";

function getInitialPosition(): SidebarPosition {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "left" || stored === "right") return stored;
  return "left";
}

export function useSidebarPosition() {
  const [position, setPosition] = useState<SidebarPosition>(getInitialPosition);

  const togglePosition = useCallback(() => {
    setPosition((prev) => {
      const next = prev === "left" ? "right" : "left";
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { position, togglePosition } as const;
}
