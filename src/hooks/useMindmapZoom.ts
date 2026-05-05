import { useCallback, useEffect, useRef } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { computeFitTransform, type ZoomTransformLike, type ContentBounds } from "../lib/mindmapZoom";

const SCALE_EXTENT: [number, number] = [0.1, 4];
const ZOOM_STEP = 1.3;

export function useMindmapZoom(contentBounds: ContentBounds | null, enabled: boolean) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement>(null);
  const transformRef = useRef<ZoomTransformLike>({ k: 1, x: 0, y: 0 });
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const initialFitRef = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    const svg = svgRef.current;
    if (!svg) return;

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent(SCALE_EXTENT)
      .filter((event) => {
        if (event.type === "wheel") return event.ctrlKey;
        const target = event.target as Element | null;
        return !target?.closest?.("[data-mindmap-node]");
      })
      .on("zoom", (event) => {
        const g = gRef.current;
        if (g) {
          const { x, y, k } = event.transform;
          g.setAttribute("transform", `translate(${x},${y}) scale(${k})`);
        }
        transformRef.current = { k: event.transform.k, x: event.transform.x, y: event.transform.y };
      });

    const sel = select(svg).call(zoomBehavior);
    sel.on("dblclick.zoom", null);
    zoomBehaviorRef.current = zoomBehavior;

    return () => {
      sel.on(".zoom", null);
      zoomBehaviorRef.current = null;
    };
  }, [enabled]);

  const contentBoundsRef = useRef(contentBounds);
  contentBoundsRef.current = contentBounds;

  const cbx = contentBounds?.x;
  const cby = contentBounds?.y;
  const cbw = contentBounds?.width;
  const cbh = contentBounds?.height;

  useEffect(() => {
    if (!enabled || cbx == null || cby == null || cbw == null || cbh == null) return;

    const svg = svgRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    if (!svg || !zoomBehavior) return;

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const bounds = { x: cbx, y: cby, width: cbw, height: cbh };
    const viewport = { width: rect.width, height: rect.height };
    const fit = computeFitTransform(bounds, viewport);
    const t = zoomIdentity.translate(fit.x, fit.y).scale(fit.k);

    if (!initialFitRef.current) return;
    select(svg).call(zoomBehavior.transform, t);
    initialFitRef.current = false;
  }, [enabled, cbx, cby, cbw, cbh]);

  const fitContent = useCallback(() => {
    const svg = svgRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    const bounds = contentBoundsRef.current;
    if (!svg || !zoomBehavior || !bounds) return;

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const viewport = { width: rect.width, height: rect.height };
    const fit = computeFitTransform(bounds, viewport);
    const t = zoomIdentity.translate(fit.x, fit.y).scale(fit.k);

    select(svg).transition().duration(300).call(zoomBehavior.transform, t);
  }, []);

  const zoomIn = useCallback(() => {
    const svg = svgRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    if (!svg || !zoomBehavior) return;

    select(svg).transition().duration(200).call(zoomBehavior.scaleBy, ZOOM_STEP);
  }, []);

  const zoomOut = useCallback(() => {
    const svg = svgRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    if (!svg || !zoomBehavior) return;

    select(svg).transition().duration(200).call(zoomBehavior.scaleBy, 1 / ZOOM_STEP);
  }, []);

  return { svgRef, gRef, transformRef, fitContent, zoomIn, zoomOut };
}
