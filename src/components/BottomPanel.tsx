import { useEffect, useState, useCallback, useRef } from "react";
import { BacklinksPanel } from "./BacklinksPanel";
import { UnlinkedMentionsPanel } from "./UnlinkedMentionsPanel";
import { usePreferencesStore } from "../stores/preferences";

interface BottomPanelProps {
  pageId: string;
}

const TAB_BAR_HEIGHT = 32;
const DEFAULT_PANEL_HEIGHT = 200;
const MIN_PANEL_HEIGHT = 100;
const STORAGE_KEY = "lit-bottom-panel-height";

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
  const [panelHeight, setPanelHeight] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return DEFAULT_PANEL_HEIGHT;
    const parsed = Number(stored);
    if (isNaN(parsed)) return DEFAULT_PANEL_HEIGHT;
    return Math.max(parsed, MIN_PANEL_HEIGHT);
  });
  const [linkedCount, setLinkedCount] = useState<number | null>(null);
  const [unlinkedCount, setUnlinkedCount] = useState<number | null>(null);
  const [hasOpenedUnlinked, setHasOpenedUnlinked] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const lastDragHeight = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);

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

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (!unfolded) return;
      e.preventDefault();

      setIsDragging(true);
      dragStartY.current = e.clientY;
      dragStartHeight.current = panelHeight;
      lastDragHeight.current = panelHeight;
      document.body.style.userSelect = "none";

      const onMouseMove = (ev: MouseEvent) => {
        const parentHeight =
          panelRef.current?.parentElement?.getBoundingClientRect().height ?? Infinity;
        const maxHeight = parentHeight * 0.6;
        const delta = dragStartY.current - ev.clientY;
        const newHeight = Math.min(
          Math.max(dragStartHeight.current + delta, MIN_PANEL_HEIGHT),
          maxHeight,
        );
        lastDragHeight.current = newHeight;
        setPanelHeight(newHeight);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        setIsDragging(false);
        document.body.style.userSelect = "";
        localStorage.setItem(STORAGE_KEY, String(lastDragHeight.current));
        cleanupRef.current = null;
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      cleanupRef.current = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.userSelect = "";
      };
    },
    [unfolded, panelHeight],
  );

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

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

  useEffect(() => {
    const handleResize = () => {
      if (!unfolded) return;
      const parentEl = panelRef.current?.parentElement;
      if (!parentEl) return;
      const parentHeight = parentEl.getBoundingClientRect().height;
      if (parentHeight <= 0) return;
      const maxHeight = parentHeight * 0.6;
      setPanelHeight((h) => {
        const clamped = Math.min(h, maxHeight);
        if (clamped !== h) {
          localStorage.setItem(STORAGE_KEY, String(clamped));
        }
        return clamped;
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [unfolded]);

  useEffect(() => {
    if (!unfolded) return;
    const parentEl = panelRef.current?.parentElement;
    if (!parentEl) return;
    const parentHeight = parentEl.getBoundingClientRect().height;
    if (parentHeight <= 0) return;
    const maxHeight = parentHeight * 0.6;
    setPanelHeight((h) => {
      const clamped = Math.min(h, maxHeight);
      if (clamped !== h) {
        localStorage.setItem(STORAGE_KEY, String(clamped));
      }
      return clamped;
    });
  }, [unfolded]);

  const height = unfolded ? panelHeight : TAB_BAR_HEIGHT;

  return (
    <div
      ref={panelRef}
      data-testid="bottom-panel"
      className="flex-shrink-0 overflow-hidden border-t border-border-faint"
      style={{
        height,
        transition: isDragging ? "none" : "height 150ms ease-out",
      }}
    >
      <div className="relative flex h-8 items-center gap-0 bg-bg-primary-alt px-4">
        <div
          data-testid="resize-handle"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            cursor: "ns-resize",
            zIndex: 10,
          }}
          onMouseDown={handleResizeStart}
        />
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
