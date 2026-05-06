import { useEffect, useRef, useState } from "react";
import { getFullSubgraph, getGraphSubgraph, getPagerank } from "../lib/ipc";
import type { SubgraphResult } from "../lib/ipc";
import { buildGraph, resolveThemeColors } from "../lib/graphLayout";
import "./GraphView.css";

export interface GraphViewProps {
  mode: "full" | "local";
  activePageId?: string | null;
  onNavigate?: (pageId: string) => void;
}

export default function GraphView({ mode, activePageId, onNavigate }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<unknown>(null);
  const layoutRef = useRef<{ kill: () => void } | null>(null);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setLoading(true);
        setError(null);

        let subgraph: SubgraphResult;
        if (mode === "local" && activePageId) {
          subgraph = await getGraphSubgraph([activePageId], 2);
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

        const sigma = new Sigma(graph, containerRef.current, {
          nodeProgramClasses: { filled: filledProgram, hollow: hollowProgram },
          hideEdgesOnMove: true,
          labelRenderedSizeThreshold: 6,
          enableEdgeEvents: false,
        });
        sigmaRef.current = sigma;

        sigma.on("clickNode", ({ node }) => {
          onNavigateRef.current?.(node);
        });

        const layout = new FA2Layout(graph, { settings: inferSettings(graph) });
        layout.start();
        layoutRef.current = layout;

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
      if (layoutRef.current) {
        layoutRef.current.kill();
        layoutRef.current = null;
      }
      if (sigmaRef.current) {
        (sigmaRef.current as { kill: () => void }).kill();
        sigmaRef.current = null;
      }
    };
  }, [mode, activePageId]);

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
      <div ref={containerRef} data-testid="graph-canvas" style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}
