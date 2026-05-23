import { useEffect, useRef } from "react";
import type { GraphNode } from "../lib/ipc";

export function getMatchingNodes(nodes: GraphNode[], query: string): string[] {
  if (!query) return [];
  const lower = query.toLowerCase();
  const matches: string[] = [];
  for (const node of nodes) {
    if (node.title.toLowerCase().includes(lower)) matches.push(node.id);
  }
  return matches;
}

export interface GraphSearchProps {
  visible: boolean;
  query: string;
  matchCount: number;
  firstMatchId?: string;
  onQueryChange: (query: string) => void;
  onNavigate: (nodeId: string) => void;
  onClose: () => void;
}

export function GraphSearch({ visible, query, matchCount, firstMatchId, onQueryChange, onNavigate, onClose }: GraphSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  if (!visible) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (query) {
        onQueryChange("");
      } else {
        onClose();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (firstMatchId) onNavigate(firstMatchId);
    }
  };

  return (
    <div data-testid="graph-search" className="graph-search">
      <input
        ref={inputRef}
        data-testid="graph-search-input"
        placeholder="Search nodes…"
        aria-label="Search graph nodes"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {query && <span data-testid="graph-search-count">{matchCount} matches</span>}
    </div>
  );
}
