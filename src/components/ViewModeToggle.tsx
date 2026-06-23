import { usePreferencesStore } from "../stores/preferences";
import { usePaneStore } from "../stores/panes";
import type { ViewMode } from "../lib/ipc";

const SHORTCUT_HINTS: Record<ViewMode, string> = {
  editor: "Editor (⌘1)",
  mindmap: "Mindmap (⌘2)",
  graph: "Graph (⌘3)",
  cardbox: "Cardbox (⌘4)",
};

export function ViewModeToggle({
  paneId,
  currentMode,
  variant = "compact",
  showShortcuts = false,
}: {
  paneId: string;
  currentMode: ViewMode;
  variant?: "compact" | "default";
  showShortcuts?: boolean;
}) {
  const graphViewEnabled = usePreferencesStore((s) => s.graphViewEnabled);
  const setPaneViewMode = usePaneStore((s) => s.setPaneViewMode);

  const isDefault = variant === "default";
  const sizeClass = isDefault ? "px-2 py-0.5 text-xs" : "px-1.5 py-0.5 text-[10px] leading-tight";
  const gapClass = isDefault ? "gap-1" : "gap-0.5";

  const btn = (mode: ViewMode, label: string) => (
    <button
      onClick={() => setPaneViewMode(paneId, mode)}
      aria-label={label}
      title={showShortcuts ? SHORTCUT_HINTS[mode] : undefined}
      className={`rounded-md ${sizeClass} ${currentMode === mode ? "bg-bg-hover text-text-normal font-medium" : "text-text-faint hover:text-text-muted"}`}
    >
      {label}
    </button>
  );

  return (
    <div className={`flex ${gapClass}`} data-testid="view-mode-toggle">
      {btn("editor", "Editor")}
      {btn("mindmap", "Mindmap")}
      {graphViewEnabled && btn("graph", "Graph")}
      {btn("cardbox", "Cardbox")}
    </div>
  );
}
