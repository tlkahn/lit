import { usePreferencesStore } from "../stores/preferences";

export function useBottomPanelPosition() {
  const mode = usePreferencesStore((s) => s.bottomPanelPosition);
  const sidebarLocation = usePreferencesStore((s) => s.sidebarLocation);
  const effectiveSide = sidebarLocation === "left" ? "right" : "left";
  return { mode, effectiveSide } as const;
}
