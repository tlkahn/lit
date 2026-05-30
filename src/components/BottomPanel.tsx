import { useEffect, useCallback, useRef } from "react";
import { BacklinksPanel } from "./BacklinksPanel";
import { UnlinkedMentionsPanel } from "./UnlinkedMentionsPanel";
import { AnnotationPanel } from "./AnnotationPanel";
import { ConversationPanel } from "./ConversationPanel";
import { usePreferencesStore } from "../stores/preferences";
import { useBottomPanelStore } from "../stores/bottomPanel";
import { MIN_PANEL_HEIGHT } from "../stores/bottomPanel";

interface BottomPanelProps {
  pageId?: string;
}

export function BottomPanel({ pageId }: BottomPanelProps) {
  const activeTab = useBottomPanelStore((s) => s.activeTab);
  const unfolded = useBottomPanelStore((s) => s.unfolded);
  const panelHeight = useBottomPanelStore((s) => s.panelHeight);
  const hasOpenedUnlinked = useBottomPanelStore((s) => s.hasOpenedUnlinked);
  const hasOpenedAnnotations = useBottomPanelStore((s) => s.hasOpenedAnnotations);
  const hasOpenedLlm = useBottomPanelStore((s) => s.hasOpenedLlm);
  const setLinkedCount = useBottomPanelStore((s) => s.setLinkedCount);
  const setUnlinkedCount = useBottomPanelStore((s) => s.setUnlinkedCount);
  const setAnnotationCount = useBottomPanelStore((s) => s.setAnnotationCount);
  const setPanelHeight = useBottomPanelStore((s) => s.setPanelHeight);

  const annotationEnabled = usePreferencesStore((s) => s.annotationEnabled);

  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const lastDragHeight = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (!unfolded) return;
      e.preventDefault();

      dragStartY.current = e.clientY;
      dragStartHeight.current = panelHeight;
      lastDragHeight.current = panelHeight;
      document.body.style.userSelect = "none";
      if (panelRef.current) panelRef.current.style.transition = "none";

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
        if (panelRef.current) panelRef.current.style.height = newHeight + "px";
        if (contentRef.current) contentRef.current.style.height = newHeight + "px";
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.userSelect = "";
        setPanelHeight(lastDragHeight.current);
        if (panelRef.current) panelRef.current.style.transition = "height 150ms ease-out";
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
    [unfolded, panelHeight, setPanelHeight],
  );

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  // Window resize re-clamp
  useEffect(() => {
    const handleResize = () => {
      if (!unfolded) return;
      const parentEl = panelRef.current?.parentElement;
      if (!parentEl) return;
      const parentHeight = parentEl.getBoundingClientRect().height;
      if (parentHeight <= 0) return;
      const maxHeight = parentHeight * 0.6;
      const current = useBottomPanelStore.getState().panelHeight;
      const clamped = Math.min(current, maxHeight);
      if (clamped !== current) {
        setPanelHeight(clamped);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [unfolded, setPanelHeight]);

  // Clamp on unfold
  useEffect(() => {
    if (!unfolded) return;
    const parentEl = panelRef.current?.parentElement;
    if (!parentEl) return;
    const parentHeight = parentEl.getBoundingClientRect().height;
    if (parentHeight <= 0) return;
    const maxHeight = parentHeight * 0.6;
    const current = useBottomPanelStore.getState().panelHeight;
    const clamped = Math.min(current, maxHeight);
    if (clamped !== current) {
      setPanelHeight(clamped);
    }
  }, [unfolded, setPanelHeight]);

  const height = unfolded ? panelHeight : 0;

  return (
    <div
      ref={panelRef}
      data-testid="bottom-panel"
      className={`relative z-10 flex-shrink-0 overflow-hidden${unfolded ? " shadow-[0_-2px_4px_rgba(0,0,0,0.08)]" : ""}`}
      style={{
        height,
        transition: "height 150ms ease-out",
      }}
    >
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
      <div
        ref={contentRef}
        role="tabpanel"
        id="bp-tabpanel"
        aria-labelledby={`bp-tab-${activeTab}`}
        className="overflow-hidden"
        style={{ height: panelHeight }}
      >
        {pageId && (
          <div style={{ display: activeTab === "linked" ? undefined : "none" }}>
            <BacklinksPanel pageId={pageId} onCountChange={setLinkedCount} contentHeight={panelHeight} />
          </div>
        )}
        {pageId && hasOpenedUnlinked && (
          <div style={{ display: activeTab === "unlinked" ? undefined : "none" }}>
            <UnlinkedMentionsPanel pageId={pageId} onCountChange={setUnlinkedCount} contentHeight={panelHeight} />
          </div>
        )}
        {pageId && annotationEnabled && hasOpenedAnnotations && (
          <div style={{ display: activeTab === "annotations" ? undefined : "none" }}>
            <AnnotationPanel pageId={pageId} onCountChange={setAnnotationCount} contentHeight={panelHeight} />
          </div>
        )}
        {hasOpenedLlm && pageId && (
          <div style={{ display: activeTab === "llm-response" ? undefined : "none" }}>
            <ConversationPanel pageId={pageId} contentHeight={panelHeight} />
          </div>
        )}
      </div>
    </div>
  );
}
