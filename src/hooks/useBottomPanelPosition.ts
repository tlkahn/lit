import { usePreferencesStore } from "../stores/preferences";

export function useBottomPanelPosition() {
  const mode = usePreferencesStore((s) => s.bottomPanelPosition);
  const sidebarLocation = usePreferencesStore((s) => s.sidebarLocation);
  const side = sidebarLocation === "left" ? "right" : "left";
  return { mode, side } as const;
}
