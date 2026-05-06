import { useEffect, useRef, useState, useCallback } from "react";
import { getFullSubgraph, getGraphSubgraph, getPagerank } from "../lib/ipc";
import type { SubgraphResult } from "../lib/ipc";
import { buildGraph, resolveThemeColors } from "../lib/graphLayout";
import { GraphToolbar } from "./GraphToolbar";
import { GraphTooltip } from "./GraphTooltip";
import "./GraphView.css";

export interface GraphViewProps {
  activePageId?: string | null;
  onNavigate?: (pageId: string) => void;
}

export default function GraphView({ activePageId, onNavigate }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<unknown>(null);
  const graphRef = useRef<unknown>(null);
  const layoutRef = useRef<{ start: () => void; stop: () => void; kill: () => void } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const rafIdRef = useRef<number>(0);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"full" | "local">("full");
  const [depth, setDepth] = useState(2);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, title: "", connections: 0 });

  const handleResetZoom = useCallback(() => {
    const sigma = sigmaRef.current as { getCamera: () => { animatedReset: () => void } } | null;
    sigma?.getCamera().animatedReset();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setLoading(true);
        setError(null);

        let subgraph: SubgraphResult;
        if (mode === "local" && activePageId) {
          subgraph = await getGraphSubgraph([activePageId], depth);
        } else {
          subgraph = await getFullSubgraph();
        }
        const pagerank = await getPagerank();

        if (cancelled) return;

        const { accentColor, stubColor } = resolveThemeColors();
        const graph = buildGraph({
          subgraph,
          pagerank,
          accentColor,
          stubColor,
          seedId: mode === "local" ? (activePageId ?? undefined) : undefined,
        });

        if (!containerRef.current || cancelled) return;

        const { default: Sigma } = await import("sigma");
        const { createNodeBorderProgram } = await import("@sigma/node-border");
        const FA2Layout = (await import("graphology-layout-forceatlas2/worker")).default;
        const { inferSettings } = await import("graphology-layout-forceatlas2");
        const { random } = await import("graphology-layout");

        if (cancelled || !containerRef.current) return;

        random.assign(graph);

        const filledProgram = createNodeBorderProgram({
          borders: [{ size: { value: 0.15, mode: "relative" }, color: { attribute: "color" } }],
        });
        const hollowProgram = createNodeBorderProgram({
          borders: [
            { size: { value: 0.15, mode: "relative" }, color: { attribute: "color" } },
            { size: { fill: true }, color: { transparent: true } },
          ],
        });
        const seedProgram = createNodeBorderProgram({
          borders: [{ size: { value: 0.3, mode: "relative" }, color: { attribute: "color" } }],
        });

        const sigma = new Sigma(graph, containerRef.current, {
          nodeProgramClasses: { filled: filledProgram, hollow: hollowProgram, seed: seedProgram },
          hideEdgesOnMove: true,
          labelRenderedSizeThreshold: 6,
          enableEdgeEvents: false,
        });
        sigmaRef.current = sigma;
        graphRef.current = graph;

        sigma.on("clickNode", ({ node }) => {
          onNavigateRef.current?.(node);
        });

        sigma.on("enterNode", ({ node, event }) => {
          hoveredNodeRef.current = node;
          const neighbors = new Set(graph.neighbors(node));
          neighbors.add(node);

          sigma.setSetting("nodeReducer", (_n: string, attrs: Record<string, unknown>) => {
            if (neighbors.has(_n)) return attrs;
            return { ...attrs, color: "#e0e0e0", label: null };
          });
          sigma.setSetting("edgeReducer", (_e: string, attrs: Record<string, unknown>) => {
            const src = graph.source(_e);
            const tgt = graph.target(_e);
            if (neighbors.has(src) && neighbors.has(tgt)) return attrs;
            return { ...attrs, hidden: true };
          });

          if (containerRef.current) {
            containerRef.current.style.cursor = "pointer";
          }

          const mouseEvent = event as { x?: number; y?: number } | undefined;
          setTooltip({
            visible: true,
            x: (mouseEvent?.x ?? 0) + 10,
            y: (mouseEvent?.y ?? 0) + 10,
            title: (graph.getNodeAttribute(node, "label") as string) || node,
            connections: graph.degree(node),
          });
        });

        sigma.on("moveBody", ({ event }) => {
          if (hoveredNodeRef.current) {
            const mouseEvent = event as { x?: number; y?: number } | undefined;
            pendingPosRef.current = { x: (mouseEvent?.x ?? 0) + 10, y: (mouseEvent?.y ?? 0) + 10 };
            if (!rafIdRef.current) {
              rafIdRef.current = requestAnimationFrame(() => {
                rafIdRef.current = 0;
                const pos = pendingPosRef.current;
                pendingPosRef.current = null;
                if (pos) {
                  setTooltip((t) => ({ ...t, ...pos }));
                }
              });
            }
          }
        });

        sigma.on("leaveNode", () => {
          hoveredNodeRef.current = null;
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = 0;
          pendingPosRef.current = null;
          sigma.setSetting("nodeReducer", null);
          sigma.setSetting("edgeReducer", null);
          if (containerRef.current) {
            containerRef.current.style.cursor = "grab";
          }
          setTooltip((t) => ({ ...t, visible: false }));
        });

        sigma.on("clickStage", () => {
          sigma.setSetting("nodeReducer", null);
          sigma.setSetting("edgeReducer", null);
        });

        const layout = new FA2Layout(graph, { settings: inferSettings(graph) });
        layout.start();
        layoutRef.current = layout;

        timerRef.current = setTimeout(() => {
          layout.stop();
          sigma.getCamera().animatedReset();
        }, 5000);

        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load graph");
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
      pendingPosRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (layoutRef.current) {
        layoutRef.current.kill();
        layoutRef.current = null;
      }
      if (sigmaRef.current) {
        (sigmaRef.current as { kill: () => void }).kill();
        sigmaRef.current = null;
      }
      graphRef.current = null;
    };
  }, [mode, depth, activePageId]);

  return (
    <div data-testid="graph-view" className="graph-view-container">
      {loading && (
        <div data-testid="graph-loading" className="graph-loading">
          Loading graph…
        </div>
      )}
      {error && (
        <div data-testid="graph-error" className="graph-error">
          {error}
        </div>
      )}
      <GraphToolbar
        mode={mode}
        depth={depth}
        localDisabled={!activePageId}
        onModeChange={setMode}
        onDepthChange={setDepth}
        onResetZoom={handleResetZoom}
      />
      <GraphTooltip {...tooltip} />
      <div ref={containerRef} data-testid="graph-canvas" style={{ position: "absolute", inset: 0, cursor: "grab" }} />
    </div>
  );
}
