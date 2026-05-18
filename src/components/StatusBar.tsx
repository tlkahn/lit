import type { IndexPhase } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { usePaneStore, findLeaf } from "../stores/panes";
import { useCursorInfoStore } from "../stores/cursorInfo";

const phaseLabels: Record<IndexPhase, string> = {
  scanning: "Scanning files...",
  parsing: "Parsing pages...",
  resolving: "Resolving links...",
  diffing: "Checking for changes...",
  building: "Building graph...",
};

export function StatusBar() {
  const graphReady = useWorkspaceStore((s) => s.graphReady);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const indexProgress = useWorkspaceStore((s) => s.indexProgress);
  const pagePath = usePaneStore((s) => findLeaf(s.root, s.focusedPaneId)?.pagePath ?? null);
  const { line, col } = useCursorInfoStore();

  if (!workspacePath) return null;

  if (!graphReady) {
    const label = indexProgress ? phaseLabels[indexProgress.phase] : "Initializing...";
    const ratio = indexProgress && indexProgress.total > 0 ? indexProgress.current / indexProgress.total : 0;
    const indeterminate = !indexProgress || indexProgress.total === 0;

    return (
      <div data-testid="status-bar" className="flex h-6 items-center justify-between bg-bg-primary-alt px-3 text-xs text-text-faint">
        <span>{label}</span>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-bg-hover">
          <div
            data-testid="status-bar-fill"
            className={`h-full rounded-full bg-interactive-accent transition-all duration-200 ${indeterminate ? "animate-pulse" : ""}`}
            style={{ width: indeterminate ? "100%" : `${Math.round(ratio * 100)}%` }}
          />
        </div>
      </div>
    );
  }

  if (!pagePath) return null;

  return (
    <div data-testid="status-bar" className="flex h-6 items-center justify-between bg-bg-primary-alt px-3 text-xs text-text-faint">
      <span data-testid="status-bar-path">{pagePath}</span>
      {line > 0 && <span data-testid="status-bar-cursor">Ln {line}, Col {col}</span>}
    </div>
  );
}
