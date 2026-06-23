import { usePreferencesStore } from "../stores/preferences";
import { usePaneStore } from "../stores/panes";
import type { ViewMode } from "../lib/ipc";

export function ViewModeToggle({ paneId, currentMode }: { paneId: string; currentMode: ViewMode }) {
  const graphViewEnabled = usePreferencesStore((s) => s.graphViewEnabled);
  const setPaneViewMode = usePaneStore((s) => s.setPaneViewMode);

  const btn = (mode: ViewMode, label: string) => (
    <button
      onClick={() => setPaneViewMode(paneId, mode)}
      aria-label={label}
      className={`rounded-md px-1.5 py-0.5 text-[10px] leading-tight ${currentMode === mode ? "bg-bg-hover text-text-normal font-medium" : "text-text-faint hover:text-text-muted"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex gap-0.5" data-testid="view-mode-toggle">
      {btn("editor", "Editor")}
      {btn("mindmap", "Mindmap")}
      {graphViewEnabled && btn("graph", "Graph")}
      {btn("cardbox", "Cardbox")}
    </div>
  );
}
