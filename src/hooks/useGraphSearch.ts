import { useState, useCallback, useRef, useEffect, type RefObject } from "react";
import { getMatchingNodes } from "../components/GraphSearch";
import { searchNodeReduce } from "../lib/graphReducers";

interface SigmaLike {
  setSetting(key: string, value: unknown): void;
  getCamera(): { animate(state: Record<string, number>): void };
  getNodeDisplayData(node: string): { x: number; y: number } | undefined;
}

interface GraphLike {
  forEachNode(cb: (node: string, attrs: Record<string, unknown>) => void): void;
  source(edge: string): string;
  target(edge: string): string;
}

interface TierSettingsLike {
  defaultEdgesHidden: boolean;
}

export function useGraphSearch(
  graphRef: RefObject<GraphLike | null>,
  sigmaRef: RefObject<SigmaLike | null>,
  tierSettingsRef: RefObject<TierSettingsLike>,
  defaultNodeReducer: (node: string, attrs: Record<string, unknown>) => Record<string, unknown>,
  onNavigateRef: RefObject<((pageId: string) => void) | undefined>,
  selectedSetRef: RefObject<Set<string>>,
  dimColorRef: RefObject<string>,
) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchOpenRef = useRef(false);
  useEffect(() => { searchOpenRef.current = searchOpen; }, [searchOpen]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<string[]>([]);

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchQuery(query);
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;
    if (!query) {
      setSearchMatches([]);
      sigma.setSetting("nodeReducer", defaultNodeReducer);
      sigma.setSetting("edgeReducer",
        tierSettingsRef.current?.defaultEdgesHidden
          ? (_e: string, attrs: Record<string, unknown>) => ({ ...attrs, hidden: true })
          : null
      );
      return;
    }
    const matches = getMatchingNodes(graph as never, query);
    setSearchMatches(matches);
    const matchSet = new Set(matches);
    sigma.setSetting("nodeReducer", (_n: string, attrs: Record<string, unknown>) => {
      return searchNodeReduce(_n, attrs, { selectedSet: selectedSetRef.current ?? new Set(), dimColor: dimColorRef.current ?? "#d1d9e0", matchSet });
    });
    sigma.setSetting("edgeReducer", (_e: string, attrs: Record<string, unknown>) => {
      const src = graph.source(_e);
      const tgt = graph.target(_e);
      if (matchSet.has(src) || matchSet.has(tgt)) return attrs;
      return { ...attrs, hidden: true };
    });
    if (matches.length === 1) {
      const pos = sigma.getNodeDisplayData(matches[0]!);
      if (pos) sigma.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.5 });
    }
  }, []);

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
    const sigma = sigmaRef.current;
    if (sigma) {
      sigma.setSetting("nodeReducer", defaultNodeReducer);
      sigma.setSetting("edgeReducer",
        tierSettingsRef.current?.defaultEdgesHidden
          ? (_e: string, attrs: Record<string, unknown>) => ({ ...attrs, hidden: true })
          : null
      );
    }
  }, [defaultNodeReducer]);

  const handleSearchNavigate = useCallback((nodeId: string) => {
    onNavigateRef.current?.(nodeId);
  }, []);

  return {
    searchOpen, setSearchOpen, searchOpenRef,
    searchQuery, searchMatches,
    handleSearchQueryChange, handleSearchClose, handleSearchNavigate,
  };
}
