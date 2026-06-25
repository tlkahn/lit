import { usePreferencesStore } from "../stores/preferences";
import { useResponsiveLayoutStore } from "../stores/responsiveLayout";

export function useBottomPanelPosition() {
  const preferredMode = usePreferencesStore((s) => s.bottomPanelPosition);
  const forceBottom = useResponsiveLayoutStore((s) => s.bottomPanelForceBottom);
  const sidebarLocation = usePreferencesStore((s) => s.sidebarLocation);
  const mode = preferredMode === "side" && forceBottom ? "bottom" : preferredMode;
  const effectiveSide = sidebarLocation === "left" ? "right" : "left";
  return { mode, effectiveSide } as const;
}
