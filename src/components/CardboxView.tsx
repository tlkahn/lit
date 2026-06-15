import { useEffect, useCallback, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { useCardboxStore } from "../stores/cardbox";
import { useWorkspaceStore } from "../stores/workspace";
import { CardboxCard } from "./CardboxCard";
import type { CardboxAnnotation } from "../lib/ipc";

export default function CardboxView() {
  const annotations = useCardboxStore((s) => s.annotations);
  const expandedUuid = useCardboxStore((s) => s.expandedUuid);
  const loading = useCardboxStore((s) => s.loading);
  const searchQuery = useCardboxStore((s) => s.searchQuery);
  const activeTypes = useCardboxStore((s) => s.activeTypes);
  const fetchAnnotations = useCardboxStore((s) => s.fetchAnnotations);
  const toggleExpand = useCardboxStore((s) => s.toggleExpand);
  const setSearchQuery = useCardboxStore((s) => s.setSearchQuery);
  const toggleType = useCardboxStore((s) => s.toggleType);
  const selectPageAtLine = useWorkspaceStore((s) => s.selectPageAtLine);

  useEffect(() => {
    fetchAnnotations();
  }, [fetchAnnotations]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("lit:graph-updated", () => {
      fetchAnnotations();
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [fetchAnnotations]);

  const handleNavigate = useCallback((ann: CardboxAnnotation) => {
    window.dispatchEvent(new CustomEvent("lit:set-view-mode", { detail: "editor" }));
    selectPageAtLine(ann.source_page_id, ann.source_line);
  }, [selectPageAtLine]);

  // Derive all unique types from annotations (for chips)
  const allTypes = useMemo(
    () => [...new Set(annotations.map((a) => a.annotation_type))].sort(),
    [annotations],
  );

  // Combined filter pipeline
  const filteredAnnotations = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return annotations.filter((ann) => {
      // Type filter
      if (activeTypes.size > 0 && !activeTypes.has(ann.annotation_type)) return false;
      // Search filter
      if (query) {
        const searchable = [ann.body, ann.original, ann.source_page_title]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!searchable.includes(query)) return false;
      }
      return true;
    });
  }, [annotations, searchQuery, activeTypes]);

  if (loading && annotations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-text-faint" data-testid="cardbox-loading">
        Loading annotations…
      </div>
    );
  }

  if (annotations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-text-faint" data-testid="cardbox-empty">
        No annotations in this workspace
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="cardbox-view">
      {/* Search + filter controls */}
      <div className="shrink-0 space-y-2 border-b border-border px-6 py-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search annotations…"
          className="w-full rounded border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-normal placeholder:text-text-faint outline-none focus:ring-1 focus:ring-interactive-accent"
          data-testid="cardbox-search"
        />
        {allTypes.length > 1 && (
          <div className="flex flex-wrap gap-1" data-testid="cardbox-type-chips">
            {allTypes.map((type) => (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={`rounded-full px-2 py-0.5 text-[11px] transition-opacity duration-150 ${
                  activeTypes.has(type) ? "opacity-100" : "opacity-40"
                }`}
                data-annotation-type={type}
                data-testid={`chip-${type}`}
              >
                {type}
              </button>
            ))}
          </div>
        )}
        <div className="text-xs text-text-faint" data-testid="cardbox-count">
          {filteredAnnotations.length === annotations.length
            ? `${annotations.length} annotations`
            : `${filteredAnnotations.length} of ${annotations.length} annotations`}
        </div>
      </div>

      {/* Card grid */}
      <div className="flex-1 overflow-y-auto p-6" data-testid="cardbox-grid">
        {filteredAnnotations.length === 0 ? (
          <div className="flex h-full items-center justify-center text-text-faint" data-testid="cardbox-no-results">
            No matching annotations
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
          >
            {filteredAnnotations.map((ann) => (
              <CardboxCard
                key={ann.uuid}
                annotation={ann}
                expanded={expandedUuid === ann.uuid}
                onToggleExpand={() => toggleExpand(ann.uuid)}
                onNavigate={() => handleNavigate(ann)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
