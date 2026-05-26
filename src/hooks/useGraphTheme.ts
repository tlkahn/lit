import { useCallback, useEffect, type RefObject, type MutableRefObject } from "react";
import { useThemeStore } from "../stores/theme";
import { resolveThemeColors } from "../lib/graphLayout";

interface GraphLike {
  forEachNode(callback: (node: string, attrs: Record<string, unknown>) => void): void;
  setNodeAttribute(node: string, attr: string, value: unknown): void;
}

interface SigmaLike {
  refresh(): void;
  setSetting(key: string, value: unknown): void;
}

export function useGraphTheme(
  graphRef: RefObject<GraphLike | null>,
  sigmaRef: RefObject<SigmaLike | null>,
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
