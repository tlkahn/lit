import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import Graph from "graphology";
import { listen } from "@tauri-apps/api/event";
import { getFullSubgraph, getGraphPositions, getGraphSubgraph, NODE_NOT_FOUND_PREFIX } from "../lib/ipc";
import type { SubgraphResult } from "../lib/ipc";
import { applyPositions, nodeLabelFromPath, populateGraph, recolorSeed, resolveThemeColors } from "../lib/graphLayout";
import { getQualitySettings, type TierSettings } from "../lib/qualityTiers";

export interface UseGraphDataOptions {
  mode: "full" | "local";
  depth: number;
  activePageId: string | null | undefined;
  showCitations?: boolean;
  showCardboxLinks?: boolean;
}

export interface UseGraphDataResult {
  graphRef: RefObject<Graph | null>;
  loading: boolean;
  error: string | null;
  graphStats: { nodes: number; edges: number } | null;
  tierSettings: TierSettings;
  dimColorRef: MutableRefObject<string>;
  dataVersion: number;
  rebuild: () => Promise<void>;
}

async function doRebuild(
  graph: Graph,
  currentMode: "full" | "local",
  currentDepth: number,
  currentActivePageId: string | null | undefined,
  dimColorRef: MutableRefObject<string>,
  generationRef: MutableRefObject<number>,
  currentShowCitations: boolean = false,
  currentShowCardboxLinks: boolean = false,
): Promise<{ stats: { nodes: number; edges: number }; tierSettings: TierSettings } | null> {
  const myGen = ++generationRef.current;

  let subgraph: SubgraphResult;
  if (currentMode === "local" && currentActivePageId) {
    const seedId = currentActivePageId;
    // Local view: the seed may be missing from the index (e.g. just-created page
    // whose synchronous reindex/watcher hasn't propagated). Fall back to an empty
    // subgraph and synthesize a seed-only node so the active page always renders.
    let local: SubgraphResult;
    try {
      local = await getGraphSubgraph([seedId], currentDepth, undefined, currentShowCitations || undefined, currentShowCardboxLinks || undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith(NODE_NOT_FOUND_PREFIX)) {
        local = { nodes: [], edges: [] };
      } else {
        throw e;
      }
    }
    if (!local.nodes.some((n) => n.id === seedId)) {
      local = {
        ...local,
        nodes: [{ id: seedId, title: nodeLabelFromPath(seedId), is_stub: false, materialization: "materialized" as const }, ...local.nodes],
      };
    }
    subgraph = local;
  } else {
    subgraph = await getFullSubgraph(currentShowCitations || undefined, currentShowCardboxLinks || undefined);
  }

  if (myGen !== generationRef.current) return null;

  const { accentColor, dimColor } = resolveThemeColors();
  dimColorRef.current = dimColor;

  graph.clear();
  populateGraph(
    graph,
    subgraph,
    accentColor,
    currentActivePageId ?? undefined,
  );

  const positions = subgraph.positions;
  if (positions && Object.keys(positions).length > 0) {
    applyPositions(graph, positions);
  }

  return {
    stats: { nodes: graph.order, edges: graph.size },
    tierSettings: getQualitySettings(graph.order),
  };
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
  const { mode, depth, activePageId, showCitations = false, showCardboxLinks = false } = options;

  const graphRef = useRef<Graph>(new Graph());
  const dimColorRef = useRef<string>("#d1d9e0");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graphStats, setGraphStats] = useState<{ nodes: number; edges: number } | null>(null);
  const [tierSettings, setTierSettings] = useState<TierSettings>(DEFAULT_TIER);
  const [dataVersion, setDataVersion] = useState(0);

  const generationRef = useRef(0);
  const prevSeedRef = useRef(activePageId);
  const modeRef = useRef(mode);
  const depthRef = useRef(depth);
  const activePageIdRef = useRef(activePageId);
  const showCitationsRef = useRef(showCitations);
  const showCardboxLinksRef = useRef(showCardboxLinks);
  modeRef.current = mode;
  depthRef.current = depth;
  activePageIdRef.current = activePageId;
  showCitationsRef.current = showCitations;
  showCardboxLinksRef.current = showCardboxLinks;

  const rebuild = useCallback(async () => {
    try {
      const result = await doRebuild(
        graphRef.current!, modeRef.current, depthRef.current,
        activePageIdRef.current, dimColorRef, generationRef,
        showCitationsRef.current, showCardboxLinksRef.current,
      );
      if (!result) return;
      setTierSettings(result.tierSettings);
      setGraphStats(result.stats);
      setLoading(false);
      setDataVersion((v) => v + 1);
    } catch {
      // non-fatal, same as event-driven rebuild
    }
  }, []);

  const effectKey = mode === "local" ? activePageId : null;

  useEffect(() => {
    let cancelled = false;

    async function initialBuild() {
      try {
        setLoading(true);
        setError(null);
        const result = await doRebuild(graphRef.current!, mode, depth, activePageId, dimColorRef, generationRef, showCitations, showCardboxLinks);
        if (cancelled || !result) return;
        setTierSettings(result.tierSettings);
        setGraphStats(result.stats);
        setLoading(false);
        setDataVersion((v) => v + 1);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load graph");
          setLoading(false);
        }
      }
    }

    initialBuild();

    return () => {
      cancelled = true;
    };
  }, [mode, depth, effectKey, showCitations, showCardboxLinks]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen("lit:graph-updated", async () => {
      if (cancelled) return;
      await rebuild();
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
        const myGen = generationRef.current;
        const positions = await getGraphPositions();
        if (cancelled || myGen !== generationRef.current) return;
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

  useEffect(() => {
    if (mode !== "full") return;
    const prev = prevSeedRef.current;
    if (prev === activePageId) return;
    const graph = graphRef.current;
    if (!graph || graph.order === 0) return;

    prevSeedRef.current = activePageId;
    const { accentColor } = resolveThemeColors();
    recolorSeed(graph, prev, activePageId, accentColor);
  }, [activePageId, mode]);

  return {
    graphRef,
    loading,
    error,
    graphStats,
    tierSettings,
    dimColorRef,
    dataVersion,
    rebuild,
  };
}
