import { usePreferencesStore } from "../stores/preferences";

export function useSidebarPosition() {
  const position = usePreferencesStore((s) => s.sidebarLocation);
  return { position } as const;
}
