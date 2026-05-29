import { useCallback, useEffect, type RefObject, type MutableRefObject } from "react";
import { useThemeStore } from "../stores/theme";
import { resolveThemeColors } from "../lib/graphLayout";
import type { SigmaLike, GraphLike } from "./graphTypes";

export function useGraphTheme(
  graphRef: RefObject<Pick<GraphLike, "forEachNode" | "setNodeAttribute"> | null>,
  sigmaRef: RefObject<Pick<SigmaLike, "refresh" | "setSetting"> | null>,
  dimColorRef: MutableRefObject<string>,
) {
  const activeThemeId = useThemeStore((s) => s.activeThemeId);

  const applyTheme = useCallback(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;
    const { accentColor, dimColor, edgeColor, labelColor } = resolveThemeColors();
    dimColorRef.current = dimColor;
    graph.forEachNode((node: string, attrs: Record<string, unknown>) => {
      if (attrs.type === "seed") return;
      graph.setNodeAttribute(node, "color", accentColor);
    });
    sigma.setSetting("defaultEdgeColor", edgeColor);
    sigma.setSetting("labelColor", { color: labelColor });
    sigma.refresh();
  }, []);

  useEffect(() => {
    if (!graphRef.current || !sigmaRef.current) return;
    applyTheme();
  }, [activeThemeId]);

  return { applyTheme };
}
