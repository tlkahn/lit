import { useEffect, useState, useCallback } from "react";
import { BacklinksPanel } from "./BacklinksPanel";
import { UnlinkedMentionsPanel } from "./UnlinkedMentionsPanel";
import { usePreferencesStore } from "../stores/preferences";

interface BottomPanelProps {
  pageId: string;
}

const TAB_BAR_HEIGHT = 32;
const DEFAULT_PANEL_HEIGHT = 200;

function TabButton({
  label,
  count,
  active,
  folded,
  onClick,
  testId,
}: {
  label: string;
  count: number | null;
  active: boolean;
  folded: boolean;
  onClick: () => void;
  testId: string;
}) {
  let borderClass = "";
  if (active && !folded) {
    borderClass = "border-b-2 border-interactive-accent text-text-normal font-medium";
  } else if (active && folded) {
    borderClass = "border-b border-border-faint";
  }

  return (
    <button
      data-testid={testId}
      className={`flex h-full items-center gap-1 px-3 text-sm text-text-muted ${borderClass}`}
      onClick={onClick}
    >
      {count !== null && count > 0 ? `${label} (${count})` : label}
    </button>
  );
}

export function BottomPanel({ pageId }: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState<"linked" | "unlinked">("linked");
  const [unfolded, setUnfolded] = useState(false);
  const [panelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const [linkedCount, setLinkedCount] = useState<number | null>(null);
  const [unlinkedCount, setUnlinkedCount] = useState<number | null>(null);
  const [hasOpenedUnlinked, setHasOpenedUnlinked] = useState(false);

  const experimentalUnlinkedReferences = usePreferencesStore(
    (s) => s.experimentalUnlinkedReferences,
  );

  const handleTabClick = useCallback(
    (tab: "linked" | "unlinked") => {
      if (tab === "unlinked") setHasOpenedUnlinked(true);
      if (!unfolded) {
        setActiveTab(tab);
        setUnfolded(true);
      } else if (activeTab === tab) {
        setUnfolded(false);
      } else {
        setActiveTab(tab);
      }
    },
    [unfolded, activeTab],
  );

  useEffect(() => {
    const handler = () => setUnfolded((u) => !u);
    window.addEventListener("lit:toggle-bottom-panel", handler);
    return () => window.removeEventListener("lit:toggle-bottom-panel", handler);
  }, []);

  useEffect(() => {
    if (!experimentalUnlinkedReferences && activeTab === "unlinked") {
      setActiveTab("linked");
      setUnfolded(false);
    }
  }, [experimentalUnlinkedReferences, activeTab]);

  useEffect(() => {
    setUnlinkedCount(null);
    if (activeTab !== "unlinked" || !unfolded) {
      setHasOpenedUnlinked(false);
    }
  }, [pageId]);

  const height = unfolded ? panelHeight : TAB_BAR_HEIGHT;

  return (
    <div
      data-testid="bottom-panel"
      className="flex-shrink-0 overflow-hidden border-t border-border-faint"
      style={{ height, transition: "height 150ms ease-out" }}
    >
      <div className="flex h-8 items-center gap-0 bg-bg-primary-alt px-4">
        <TabButton
          testId="tab-linked"
          label="Linked References"
          count={linkedCount}
          active={activeTab === "linked"}
          folded={!unfolded}
          onClick={() => handleTabClick("linked")}
        />
        {experimentalUnlinkedReferences && (
          <TabButton
            testId="tab-unlinked"
            label="Unlinked References"
            count={unlinkedCount}
            active={activeTab === "unlinked"}
            folded={!unfolded}
            onClick={() => handleTabClick("unlinked")}
          />
        )}
      </div>
      <div className="overflow-y-auto" style={{ height: panelHeight - TAB_BAR_HEIGHT }}>
        <div style={{ display: activeTab === "linked" ? undefined : "none" }}>
          <BacklinksPanel pageId={pageId} onCountChange={setLinkedCount} />
        </div>
        {hasOpenedUnlinked && (
          <div style={{ display: activeTab === "unlinked" ? undefined : "none" }}>
            <UnlinkedMentionsPanel pageId={pageId} onCountChange={setUnlinkedCount} />
          </div>
        )}
      </div>
    </div>
  );
}
