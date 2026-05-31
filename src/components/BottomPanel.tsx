import { useEffect, useCallback, useRef } from "react";
import { BacklinksPanel } from "./BacklinksPanel";
import { UnlinkedMentionsPanel } from "./UnlinkedMentionsPanel";
import { AnnotationPanel } from "./AnnotationPanel";
import { ConversationPanel } from "./ConversationPanel";
import { usePreferencesStore } from "../stores/preferences";
import { useBottomPanelStore } from "../stores/bottomPanel";
import { MIN_PANEL_HEIGHT, MIN_PANEL_WIDTH } from "../stores/bottomPanel";

interface BottomPanelProps {
  pageId?: string;
  direction?: "bottom" | "left" | "right";
}

function getResizeHandleStyle(direction: "bottom" | "left" | "right"): React.CSSProperties {
  if (direction === "right") {
    return { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, cursor: "ew-resize", zIndex: 10 };
  }
  if (direction === "left") {
    return { position: "absolute", right: 0, top: 0, bottom: 0, width: 4, cursor: "ew-resize", zIndex: 10 };
  }
  return { position: "absolute", top: 0, left: 0, right: 0, height: 4, cursor: "ns-resize", zIndex: 10 };
}

function getShadowClass(direction: "bottom" | "left" | "right"): string {
  if (direction === "right") return "shadow-[-2px_0_4px_rgba(0,0,0,0.08)]";
  if (direction === "left") return "shadow-[2px_0_4px_rgba(0,0,0,0.08)]";
  return "shadow-[0_-2px_4px_rgba(0,0,0,0.08)]";
}

export function BottomPanel({ pageId, direction = "bottom" }: BottomPanelProps) {
  const isVertical = direction !== "bottom";

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
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const lastDragHeight = useRef(0);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const lastDragWidth = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  const dimension = isVertical ? "width" : "height";
  const transitionStr = `${dimension} 150ms ease-out`;

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (!unfolded) return;
      e.preventDefault();

      document.body.style.userSelect = "none";
      if (panelRef.current) panelRef.current.style.transition = "none";

      if (isVertical) {
        dragStartX.current = e.clientX;
        dragStartWidth.current = panelWidth;
        lastDragWidth.current = panelWidth;

        const onMouseMove = (ev: MouseEvent) => {
          const parentWidth =
            panelRef.current?.parentElement?.getBoundingClientRect().width ?? Infinity;
          const maxWidth = parentWidth * 0.5;
          const delta = direction === "right"
            ? dragStartX.current - ev.clientX
            : ev.clientX - dragStartX.current;
          const newWidth = Math.min(
            Math.max(dragStartWidth.current + delta, MIN_PANEL_WIDTH),
            maxWidth,
          );
          lastDragWidth.current = newWidth;
          if (panelRef.current) panelRef.current.style.width = newWidth + "px";
          if (contentRef.current) contentRef.current.style.width = newWidth + "px";
        };

        const onMouseUp = () => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          document.body.style.userSelect = "";
          setPanelWidth(lastDragWidth.current);
          if (panelRef.current) panelRef.current.style.transition = transitionStr;
          cleanupRef.current = null;
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        cleanupRef.current = () => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          document.body.style.userSelect = "";
        };
      } else {
        dragStartY.current = e.clientY;
        dragStartHeight.current = panelHeight;
        lastDragHeight.current = panelHeight;

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
          if (panelRef.current) panelRef.current.style.transition = transitionStr;
          cleanupRef.current = null;
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        cleanupRef.current = () => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          document.body.style.userSelect = "";
        };
      }
    },
    [unfolded, panelHeight, panelWidth, setPanelHeight, setPanelWidth, isVertical, direction, transitionStr],
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
      const parentRect = parentEl.getBoundingClientRect();

      if (isVertical) {
        const parentWidth = parentRect.width;
        if (parentWidth <= 0) return;
        const maxWidth = parentWidth * 0.5;
        const current = useBottomPanelStore.getState().panelWidth;
        const clamped = Math.min(current, maxWidth);
        if (clamped !== current) {
          setPanelWidth(clamped);
        }
      } else {
        const parentHeight = parentRect.height;
        if (parentHeight <= 0) return;
        const maxHeight = parentHeight * 0.6;
        const current = useBottomPanelStore.getState().panelHeight;
        const clamped = Math.min(current, maxHeight);
        if (clamped !== current) {
          setPanelHeight(clamped);
        }
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [unfolded, setPanelHeight, setPanelWidth, isVertical]);

  // Clamp on unfold
  useEffect(() => {
    if (!unfolded) return;
    const parentEl = panelRef.current?.parentElement;
    if (!parentEl) return;
    const parentRect = parentEl.getBoundingClientRect();

    if (isVertical) {
      const parentWidth = parentRect.width;
      if (parentWidth <= 0) return;
      const maxWidth = parentWidth * 0.5;
      const current = useBottomPanelStore.getState().panelWidth;
      const clamped = Math.min(current, maxWidth);
      if (clamped !== current) {
        setPanelWidth(clamped);
      }
    } else {
      const parentHeight = parentRect.height;
      if (parentHeight <= 0) return;
      const maxHeight = parentHeight * 0.6;
      const current = useBottomPanelStore.getState().panelHeight;
      const clamped = Math.min(current, maxHeight);
      if (clamped !== current) {
        setPanelHeight(clamped);
      }
    }
  }, [unfolded, setPanelHeight, setPanelWidth, isVertical]);

  const size = isVertical
    ? (unfolded ? panelWidth : 0)
    : (unfolded ? panelHeight : 0);

  const panelStyle: React.CSSProperties = isVertical
    ? { width: size, transition: transitionStr }
    : { height: size, transition: transitionStr };

  const contentSize = isVertical ? panelWidth : panelHeight;
  const contentStyle: React.CSSProperties = isVertical
    ? { width: contentSize }
    : { height: contentSize };

  const shadowClass = unfolded ? ` ${getShadowClass(direction)}` : "";

  return (
    <div
      ref={panelRef}
      data-testid="bottom-panel"
      className={`relative z-10 flex-shrink-0 overflow-hidden${shadowClass}`}
      style={panelStyle}
    >
      <div
        data-testid="resize-handle"
        style={getResizeHandleStyle(direction)}
        onMouseDown={handleResizeStart}
      />
      <div
        ref={contentRef}
        role="tabpanel"
        id="bp-tabpanel"
        aria-labelledby={`bp-tab-${activeTab}`}
        className="overflow-hidden"
        style={contentStyle}
      >
        {pageId && (
          <div style={{ display: activeTab === "linked" ? undefined : "none", height: "100%" }}>
            <BacklinksPanel pageId={pageId} onCountChange={setLinkedCount} contentHeight={panelHeight} />
          </div>
        )}
        {pageId && hasOpenedUnlinked && (
          <div style={{ display: activeTab === "unlinked" ? undefined : "none", height: "100%" }}>
            <UnlinkedMentionsPanel pageId={pageId} onCountChange={setUnlinkedCount} contentHeight={panelHeight} />
          </div>
        )}
        {pageId && annotationEnabled && hasOpenedAnnotations && (
          <div style={{ display: activeTab === "annotations" ? undefined : "none", height: "100%" }}>
            <AnnotationPanel pageId={pageId} onCountChange={setAnnotationCount} contentHeight={panelHeight} />
          </div>
        )}
        {hasOpenedLlm && (
          <div style={{ display: activeTab === "llm-response" ? undefined : "none", height: "100%" }}>
            <ConversationPanel pageId={pageId ?? undefined} />
          </div>
        )}
      </div>
    </div>
  );
}
