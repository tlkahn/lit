import { useEffect, useRef, useCallback, type RefObject, type MutableRefObject } from "react";
import type Graph from "graphology";
import type { TierSettings } from "../lib/qualityTiers";
import { defaultNodeReduce } from "../lib/graphReducers";
import { SELECTED_COLOR } from "../lib/graphLayout";
import { createNudgeController, type NudgeController } from "../lib/graphNudge";
import { useGraphSelectionStore } from "../stores/graphSelection";
import type { SigmaLike } from "./graphTypes";

export interface UseGraphRendererOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  graphRef: RefObject<Graph | null>;
  tierSettings: TierSettings;
  dimColorRef: MutableRefObject<string>;
  dataVersion: number;
  onNavigate?: (pageId: string) => void;
  onContextMenu?: (menu: { nodeId: string; x: number; y: number }) => void;
}

export interface UseGraphRendererResult {
  sigmaRef: RefObject<SigmaLike | null>;
  hoveredNodeRef: RefObject<string | null>;
  selectedSetRef: MutableRefObject<Set<string>>;
  defaultNodeReducer: (node: string, attrs: Record<string, unknown>) => Record<string, unknown>;
  tierSettingsRef: RefObject<TierSettings>;
  resetZoom: () => void;
  refresh: () => void;
}

export function useGraphRenderer(options: UseGraphRendererOptions): UseGraphRendererResult {
  const { containerRef, graphRef, tierSettings, dimColorRef, dataVersion, onNavigate, onContextMenu } = options;

  const sigmaRef = useRef<SigmaLike | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const selectedSetRef = useRef<Set<string>>(new Set());
  const tierSettingsRef = useRef<TierSettings>(tierSettings);
  tierSettingsRef.current = tierSettings;
  const nudgeRef = useRef<NudgeController | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const selectStartRef = useRef<((e: Event) => void) | null>(null);
  const prevDataVersionRef = useRef(dataVersion);

  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onContextMenuRef = useRef(onContextMenu);
  onContextMenuRef.current = onContextMenu;

  const defaultNodeReducer = useCallback((_n: string, attrs: Record<string, unknown>) => {
    return defaultNodeReduce(_n, attrs, { selectedSet: selectedSetRef.current, dimColor: dimColorRef.current });
  }, []);

  const resetZoom = useCallback(() => {
    sigmaRef.current?.getCamera().animatedReset();
  }, []);

  const refresh = useCallback(() => {
    sigmaRef.current?.refresh();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const graph = graphRef.current;
      const container = containerRef.current;
      if (!graph || !container) return;

      const { default: Sigma } = await import("sigma");
      const { createNodeBorderProgram } = await import("@sigma/node-border");

      if (cancelled) return;

      const ts = tierSettingsRef.current;

      const filledProgram = createNodeBorderProgram({
        borders: [
          { size: { value: 0.08, mode: "relative" }, color: { transparent: true } },
          { size: { fill: true }, color: { attribute: "color" } },
        ],
      });
      const seedProgram = createNodeBorderProgram({
        borders: [
          { size: { value: 0.12, mode: "relative" }, color: { transparent: true } },
          { size: { fill: true }, color: { attribute: "color" } },
        ],
      });

      const sigma = new Sigma(graph, container, {
        nodeProgramClasses: { filled: filledProgram, seed: seedProgram },
        hideEdgesOnMove: ts.hideEdgesOnMove,
        hideLabelsOnMove: ts.hideLabelsOnMove,
        labelRenderedSizeThreshold: ts.labelRenderedSizeThreshold,
        enableEdgeEvents: ts.enableEdgeEvents,
      }) as unknown as SigmaLike;

      sigmaRef.current = sigma;

      if (ts.tier === "small" || ts.tier === "medium") {
        nudgeRef.current = createNudgeController(graph, () => sigma.refresh());
      }

      if (ts.defaultEdgesHidden) {
        sigma.setSetting("edgeReducer", (_e: string, attrs: Record<string, unknown>) => ({ ...attrs, hidden: true }));
      }

      sigma.setSetting("nodeReducer", defaultNodeReducer);

      const restoreDefaultReducers = () => {
        sigma.setSetting("nodeReducer", defaultNodeReducer);
        sigma.setSetting("edgeReducer",
          tierSettingsRef.current.defaultEdgesHidden
            ? (_e: string, attrs: Record<string, unknown>) => ({ ...attrs, hidden: true })
            : null
        );
      };

      sigma.on("clickNode", (({ node, event }: { node: string; event: { original?: { metaKey?: boolean; ctrlKey?: boolean } } }) => {
        const orig = event?.original;
        if (orig?.metaKey || orig?.ctrlKey) {
          useGraphSelectionStore.getState().clearSelection();
          onNavigateRef.current?.(node);
          return;
        }
        useGraphSelectionStore.getState().toggleNode(node);
      }) as (...args: unknown[]) => void);

      sigma.on("rightClickNode", (({ node, event }: { node: string; event: { original?: MouseEvent } }) => {
        if (event?.original) event.original.preventDefault();
        window.getSelection()?.removeAllRanges();
        const orig = event?.original;
        onContextMenuRef.current?.({
          nodeId: node,
          x: orig?.clientX ?? 0,
          y: orig?.clientY ?? 0,
        });
      }) as (...args: unknown[]) => void);

      sigma.on("enterNode", (({ node }: { node: string }) => {
        hoveredNodeRef.current = node;
        nudgeRef.current?.enter(node);

        sigma.setSetting("nodeReducer", (_n: string, attrs: Record<string, unknown>) => {
          if (_n === node) {
            return selectedSetRef.current.has(_n)
              ? { ...attrs, color: SELECTED_COLOR, forceLabel: true, highlighted: true }
              : { ...attrs, forceLabel: true };
          }
          return defaultNodeReduce(_n, attrs, { selectedSet: selectedSetRef.current, dimColor: dimColorRef.current });
        });

        if (containerRef.current) {
          containerRef.current.style.cursor = "pointer";
        }
      }) as (...args: unknown[]) => void);

      sigma.on("leaveNode", (() => {
        hoveredNodeRef.current = null;
        nudgeRef.current?.leave();
        restoreDefaultReducers();
        if (containerRef.current) {
          containerRef.current.style.cursor = "grab";
        }
      }) as (...args: unknown[]) => void);

      sigma.on("clickStage", (() => {
        useGraphSelectionStore.getState().clearSelection();
        restoreDefaultReducers();
      }) as (...args: unknown[]) => void);

      sigma.on("rightClickStage", (({ event }: { event: { original?: MouseEvent } }) => {
        if (event?.original) event.original.preventDefault();
        window.getSelection()?.removeAllRanges();
      }) as (...args: unknown[]) => void);

      const onSelectStart = (e: Event) => e.preventDefault();
      container.addEventListener("selectstart", onSelectStart);
      selectStartRef.current = onSelectStart;

      selectedSetRef.current = new Set(useGraphSelectionStore.getState().selectedNodes);
      unsubRef.current = useGraphSelectionStore.subscribe((state, prev) => {
        if (state.selectedNodes !== prev.selectedNodes) {
          selectedSetRef.current = new Set(state.selectedNodes);
          sigma.refresh();
        }
      });
    }

    init();

    return () => {
      cancelled = true;
      nudgeRef.current?.dispose();
      nudgeRef.current = null;
      unsubRef.current?.();
      unsubRef.current = null;
      if (selectStartRef.current && containerRef.current) {
        containerRef.current.removeEventListener("selectstart", selectStartRef.current);
        selectStartRef.current = null;
      }
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
    };
  }, [tierSettings.tier]);

  useEffect(() => {
    if (!sigmaRef.current) return;
    if (dataVersion === prevDataVersionRef.current) return;
    prevDataVersionRef.current = dataVersion;
    sigmaRef.current.refresh();
    sigmaRef.current.getCamera().animatedReset();
  }, [dataVersion]);

  return {
    sigmaRef,
    hoveredNodeRef,
    selectedSetRef,
    defaultNodeReducer,
    tierSettingsRef,
    resetZoom,
    refresh,
  };
}
