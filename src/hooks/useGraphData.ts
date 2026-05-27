import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import Graph from "graphology";
import { listen } from "@tauri-apps/api/event";
import { getFullSubgraph, getGraphPositions, getGraphSubgraph } from "../lib/ipc";
import type { SubgraphResult } from "../lib/ipc";
import { applyPositions, populateGraph, resolveThemeColors } from "../lib/graphLayout";
import { getQualitySettings, type TierSettings } from "../lib/qualityTiers";

export interface UseGraphDataOptions {
  mode: "full" | "local";
  depth: number;
  activePageId: string | null | undefined;
}

export interface UseGraphDataResult {
  graphRef: RefObject<Graph | null>;
  loading: boolean;
  error: string | null;
  graphStats: { nodes: number; edges: number } | null;
  tierSettings: TierSettings;
  dimColorRef: MutableRefObject<string>;
  dataVersion: number;
}

const DEFAULT_TIER: TierSettings = {
  tier: "small",
  labelRenderedSizeThreshold: Infinity,
  enableEdgeEvents: true,
  hideEdgesOnMove: false,
  hideLabelsOnMove: false,
  defaultEdgesHidden: false,
};

export function useGraphData(options: UseGraphDataOptions): UseGraphDataResult {
  const { mode, depth, activePageId } = options;

  const graphRef = useRef<Graph>(new Graph());
  const dimColorRef = useRef<string>("#d1d9e0");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graphStats, setGraphStats] = useState<{ nodes: number; edges: number } | null>(null);
  const [tierSettings, setTierSettings] = useState<TierSettings>(DEFAULT_TIER);
  const [dataVersion, setDataVersion] = useState(0);

  const modeRef = useRef(mode);
  const depthRef = useRef(depth);
  const activePageIdRef = useRef(activePageId);
  modeRef.current = mode;
  depthRef.current = depth;
  activePageIdRef.current = activePageId;

  const effectKey = mode === "local" ? activePageId : null;

  useEffect(() => {
    let cancelled = false;

    async function rebuild() {
      try {
        setLoading(true);
        setError(null);

        let subgraph: SubgraphResult;
        if (mode === "local" && activePageId) {
          subgraph = await getGraphSubgraph([activePageId], depth);
        } else {
          subgraph = await getFullSubgraph();
        }

        if (cancelled) return;

        const { accentColor, dimColor } = resolveThemeColors();
        dimColorRef.current = dimColor;

        const graph = graphRef.current!;
        graph.clear();
        populateGraph(graph, subgraph, accentColor, mode === "local" ? (activePageId ?? undefined) : undefined);

        const positions = subgraph.positions;
        if (positions && Object.keys(positions).length > 0) {
          applyPositions(graph, positions);
        }

        const settings = getQualitySettings(graph.order);
        setTierSettings(settings);
        setGraphStats({ nodes: graph.order, edges: graph.size });
        setLoading(false);
        setDataVersion((v) => v + 1);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load graph");
          setLoading(false);
        }
      }
    }

    rebuild();

    return () => {
      cancelled = true;
    };
  }, [mode, depth, effectKey]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen("lit:graph-updated", async () => {
      if (cancelled) return;

      try {
        let subgraph: SubgraphResult;
        if (modeRef.current === "local" && activePageIdRef.current) {
          subgraph = await getGraphSubgraph([activePageIdRef.current], depthRef.current);
        } else {
          subgraph = await getFullSubgraph();
        }

        if (cancelled) return;

        const { accentColor, dimColor } = resolveThemeColors();
        dimColorRef.current = dimColor;

        const graph = graphRef.current!;
        graph.clear();
        populateGraph(graph, subgraph, accentColor, modeRef.current === "local" ? (activePageIdRef.current ?? undefined) : undefined);

        const positions = subgraph.positions;
        if (positions && Object.keys(positions).length > 0) {
          applyPositions(graph, positions);
        }

        setTierSettings(getQualitySettings(graph.order));
        setGraphStats({ nodes: graph.order, edges: graph.size });
        setDataVersion((v) => v + 1);
      } catch {
        // event-driven rebuild failures are non-fatal
      }
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen("lit:layout-ready", async () => {
      if (cancelled) return;
      try {
        const positions = await getGraphPositions();
        if (cancelled) return;
        if (positions && Object.keys(positions).length > 0) {
          applyPositions(graphRef.current!, positions);
          setDataVersion((v) => v + 1);
        }
      } catch {
        // positions unavailable — non-fatal
      }
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return {
    graphRef,
    loading,
    error,
    graphStats,
    tierSettings,
    dimColorRef,
    dataVersion,
  };
}
