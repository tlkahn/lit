import { useEffect, useRef, type RefObject } from "react";
import { BacklinksPanel } from "./BacklinksPanel";
import { UnlinkedMentionsPanel } from "./UnlinkedMentionsPanel";
import { AnnotationPanel } from "./AnnotationPanel";
import { ConversationPanel } from "./ConversationPanel";
import { ResizeHandle, getResizeConfig, type ResizeConfig } from "./ResizeHandle";
import { usePreferencesStore } from "../stores/preferences";
import { useBottomPanelStore } from "../stores/bottomPanel";

interface BottomPanelProps {
  pageId?: string;
  direction?: "bottom" | "left" | "right";
}

function getShadowClass(direction: "bottom" | "left" | "right"): string {
  if (direction === "right") return "shadow-[-2px_0_4px_rgba(0,0,0,0.08)]";
  if (direction === "left") return "shadow-[2px_0_4px_rgba(0,0,0,0.08)]";
  return "shadow-[0_-2px_4px_rgba(0,0,0,0.08)]";
}

function clampPanelSize(
  panelRef: RefObject<HTMLDivElement | null>,
  config: ResizeConfig,
  getSize: () => number,
  setSize: (v: number) => void,
): void {
  const parentEl = panelRef.current?.parentElement;
  if (!parentEl) return;
  const parentDim = parentEl.getBoundingClientRect()[config.dimension];
  if (parentDim <= 0) return;
  const max = parentDim * config.maxRatio;
  const current = getSize();
  const clamped = Math.min(current, max);
  if (clamped !== current) setSize(clamped);
}

export function BottomPanel({ pageId, direction = "bottom" }: BottomPanelProps) {
  const isVertical = direction !== "bottom";
  const config = getResizeConfig(direction);

  const activeTab = useBottomPanelStore((s) => s.activeTab);
  const unfolded = useBottomPanelStore((s) => s.unfolded);
  const panelHeight = useBottomPanelStore((s) => s.panelHeight);
  const panelWidth = useBottomPanelStore((s) => s.panelWidth);
  const hasOpenedUnlinked = useBottomPanelStore((s) => s.hasOpenedUnlinked);
  const hasOpenedAnnotations = useBottomPanelStore((s) => s.hasOpenedAnnotations);
  const hasOpenedLlm = useBottomPanelStore((s) => s.hasOpenedLlm);
  const setLinkedCount = useBottomPanelStore((s) => s.setLinkedCount);
  const setUnlinkedCount = useBottomPanelStore((s) => s.setUnlinkedCount);
  const setAnnotationCount = useBottomPanelStore((s) => s.setAnnotationCount);
  const setPanelHeight = useBottomPanelStore((s) => s.setPanelHeight);
  const setPanelWidth = useBottomPanelStore((s) => s.setPanelWidth);

  const annotationEnabled = usePreferencesStore((s) => s.annotationEnabled);

  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const getSize = isVertical
    ? () => useBottomPanelStore.getState().panelWidth
    : () => useBottomPanelStore.getState().panelHeight;
  const setSize = isVertical ? setPanelWidth : setPanelHeight;

  useEffect(() => {
    const handleResize = () => {
      if (!unfolded) return;
      clampPanelSize(panelRef, config, getSize, setSize);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [unfolded, config, getSize, setSize]);

  useEffect(() => {
    if (!unfolded) return;
    clampPanelSize(panelRef, config, getSize, setSize);
  }, [unfolded, config, getSize, setSize]);

  const size = isVertical
    ? (unfolded ? panelWidth : 0)
    : (unfolded ? panelHeight : 0);

  const panelStyle: React.CSSProperties = isVertical
    ? { width: size, transition: config.transition }
    : { height: size, transition: config.transition };

  const contentSize = isVertical ? panelWidth : panelHeight;
  const contentStyle: React.CSSProperties = isVertical
    ? { width: contentSize }
    : { height: contentSize };

  const shadowClass = unfolded ? ` ${getShadowClass(direction)}` : "";

  const tabWrapperStyle = (tabId: string): React.CSSProperties => ({
    display: activeTab === tabId ? (isVertical ? "flex" : undefined) : "none",
    ...(isVertical
      ? { flexDirection: "column" as const, flex: 1, minHeight: 0 }
      : { height: "100%" }),
  });

  return (
    <div
      ref={panelRef}
      data-testid="bottom-panel"
      className={`relative z-10 flex-shrink-0 overflow-hidden${isVertical ? " h-full text-sm" : ""}${shadowClass}`}
      style={panelStyle}
    >
      <ResizeHandle
        direction={direction}
        currentSize={isVertical ? panelWidth : panelHeight}
        enabled={unfolded}
        panelRef={panelRef}
        contentRef={contentRef}
        onResizeEnd={setSize}
      />
      <div
        ref={contentRef}
        role="tabpanel"
        id="bp-tabpanel"
        aria-labelledby={`bp-tab-${activeTab}`}
        className={`overflow-hidden${isVertical ? " flex h-full flex-col" : ""}`}
        style={contentStyle}
      >
        {pageId && (
          <div style={tabWrapperStyle("linked")}>
            <BacklinksPanel pageId={pageId} onCountChange={setLinkedCount} contentHeight={isVertical ? undefined : panelHeight} />
          </div>
        )}
        {pageId && hasOpenedUnlinked && (
          <div style={tabWrapperStyle("unlinked")}>
            <UnlinkedMentionsPanel pageId={pageId} onCountChange={setUnlinkedCount} contentHeight={isVertical ? undefined : panelHeight} />
          </div>
        )}
        {pageId && annotationEnabled && hasOpenedAnnotations && (
          <div style={tabWrapperStyle("annotations")}>
            <AnnotationPanel pageId={pageId} onCountChange={setAnnotationCount} contentHeight={isVertical ? undefined : panelHeight} />
          </div>
        )}
        {hasOpenedLlm && (
          <div style={tabWrapperStyle("llm-response")}>
            <ConversationPanel pageId={pageId ?? undefined} />
          </div>
        )}
      </div>
    </div>
  );
}
