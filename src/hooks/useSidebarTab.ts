import { useState, useCallback } from "react";

export type SidebarTab = "files" | "outline" | "search" | "references";

const STORAGE_KEY = "lit-sidebar-tab";

function getInitialTab(): SidebarTab {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "files" || stored === "outline" || stored === "search" || stored === "references") return stored;
  return "files";
}

export function useSidebarTab() {
  const [tab, setTabState] = useState<SidebarTab>(getInitialTab);

  const setTab = useCallback((next: SidebarTab) => {
    setTabState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  return { tab, setTab } as const;
}
