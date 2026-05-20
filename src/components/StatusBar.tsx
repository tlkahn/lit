import type { IndexPhase } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { useCursorInfoStore } from "../stores/cursorInfo";
import { useBottomPanelStore } from "../stores/bottomPanel";
import { usePreferencesStore } from "../stores/preferences";
import { useLlmResponseStore } from "../stores/llmResponse";
import { usePaneStore, findLeaf } from "../stores/panes";
import { BufferStack } from "./BufferStack";
import type { TabId } from "../stores/bottomPanel";

const phaseLabels: Record<IndexPhase, string> = {
  scanning: "Scanning files...",
  parsing: "Parsing pages...",
  resolving: "Resolving links...",
  diffing: "Checking for changes...",
  building: "Building graph...",
};

function BottomPanelTabs() {
  const focusedLeaf = usePaneStore((s) => findLeaf(s.root, s.focusedPaneId));
  const hasPage = focusedLeaf?.pagePath != null;

  const activeTab = useBottomPanelStore((s) => s.activeTab);
  const unfolded = useBottomPanelStore((s) => s.unfolded);
  const linkedCount = useBottomPanelStore((s) => s.linkedCount);
  const unlinkedCount = useBottomPanelStore((s) => s.unlinkedCount);
  const annotationCount = useBottomPanelStore((s) => s.annotationCount);
  const handleTabClick = useBottomPanelStore((s) => s.handleTabClick);

  const experimentalUnlinkedReferences = usePreferencesStore(
    (s) => s.experimentalUnlinkedReferences,
  );
  const annotationEnabled = usePreferencesStore((s) => s.annotationEnabled);
  const llmStatus = useLlmResponseStore((s) => s.status);

  if (!hasPage) return null;

  return (
    <div className="flex items-center" data-testid="bottom-panel-tabs">
      <TabButton
        tab="linked"
        label="Linked References"
        count={linkedCount}
        active={activeTab === "linked"}
        unfolded={unfolded}
        onClick={handleTabClick}
      />
      {experimentalUnlinkedReferences && (
        <TabButton
          tab="unlinked"
          label="Unlinked References"
          count={unlinkedCount}
          active={activeTab === "unlinked"}
          unfolded={unfolded}
          onClick={handleTabClick}
        />
      )}
      {annotationEnabled && annotationCount > 0 && (
        <TabButton
          tab="annotations"
          label="Annotations"
          count={annotationCount}
          active={activeTab === "annotations"}
          unfolded={unfolded}
          onClick={handleTabClick}
        />
      )}
      {llmStatus !== "idle" && (
        <TabButton
          tab="llm-response"
          label="LLM"
          count={null}
          active={activeTab === "llm-response"}
          unfolded={unfolded}
          onClick={handleTabClick}
        />
      )}
    </div>
  );
}

function TabButton({
  tab,
  label,
  count,
  active,
  unfolded,
  onClick,
}: {
  tab: TabId;
  label: string;
  count: number | null;
  active: boolean;
  unfolded: boolean;
  onClick: (tab: TabId) => void;
}) {
  let highlight = "text-text-faint hover:text-text-muted";
  if (active && unfolded) {
    highlight = "text-text-normal font-medium";
  } else if (active && !unfolded) {
    highlight = "text-text-muted";
  }

  const text = count !== null && count > 0 ? `${label} (${count})` : label;

  return (
    <button
      role="tab"
      aria-selected={active && unfolded}
      data-testid={`tab-${tab}`}
      className={`px-2 text-xs ${highlight}`}
      onClick={() => onClick(tab)}
    >
      {text}
    </button>
  );
}

export function StatusBar() {
  const graphReady = useWorkspaceStore((s) => s.graphReady);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const indexProgress = useWorkspaceStore((s) => s.indexProgress);
  const line = useCursorInfoStore((s) => s.line);
  const col = useCursorInfoStore((s) => s.col);

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

  return (
    <div data-testid="status-bar" className="flex h-6 items-center justify-between bg-bg-primary-alt px-3 text-xs text-text-faint">
      <BufferStack />
      <div className="flex items-center">
        <BottomPanelTabs />
        {line > 0 && <span data-testid="status-bar-cursor" className="ml-3">Ln {line}, Col {col}</span>}
      </div>
    </div>
  );
}
