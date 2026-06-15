import { useEffect, useCallback, useMemo, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { useCardboxStore } from "../stores/cardbox";
import { useWorkspaceStore } from "../stores/workspace";
import { useCardboxKeyboard } from "../hooks/useCardboxKeyboard";
import { CardboxCard } from "./CardboxCard";
import { SortableCard } from "./SortableCard";
import { LinkPicker } from "./LinkPicker";
import type { CardboxAnnotation } from "../lib/ipc";

const EMPTY_LINKED: CardboxAnnotation[] = [];

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
  const order = useCardboxStore((s) => s.order);
  const setOrder = useCardboxStore((s) => s.setOrder);
  const loadLayout = useCardboxStore((s) => s.loadLayout);
  const saveLayout = useCardboxStore((s) => s.saveLayout);
  const links = useCardboxStore((s) => s.links);
  const addLink = useCardboxStore((s) => s.addLink);
  const removeLink = useCardboxStore((s) => s.removeLink);
  const selectPageAtLine = useWorkspaceStore((s) => s.selectPageAtLine);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  useEffect(() => {
    fetchAnnotations().then(() => loadLayout());
  }, [fetchAnnotations, loadLayout]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveLayout(), 500);
  }, [saveLayout]);
  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveLayout();
    }
  }, [saveLayout]);

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
      // Type filter (null = not initialized yet, show all; empty set = user deselected all, show none)
      if (activeTypes !== null && activeTypes.size > 0 && !activeTypes.has(ann.annotation_type)) return false;
      if (activeTypes !== null && activeTypes.size === 0) return false;
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

  // Sort filtered annotations by user's custom order
  const sortedAnnotations = useMemo(() => {
    if (order.length === 0) return filteredAnnotations;
    const orderMap = new Map(order.map((uuid, i) => [uuid, i]));
    return [...filteredAnnotations].sort((a, b) => {
      const ai = orderMap.get(a.uuid) ?? Infinity;
      const bi = orderMap.get(b.uuid) ?? Infinity;
      return ai - bi;
    });
  }, [filteredAnnotations, order]);

  const linkMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [a, b] of links) {
      if (!map.has(a)) map.set(a, []);
      if (!map.has(b)) map.set(b, []);
      map.get(a)!.push(b);
      map.get(b)!.push(a);
    }
    return map;
  }, [links]);

  const annotationMap = useMemo(() => {
    const map = new Map<string, CardboxAnnotation>();
    for (const ann of annotations) map.set(ann.uuid, ann);
    return map;
  }, [annotations]);

  const linkedCardsMap = useMemo(() => {
    const map = new Map<string, CardboxAnnotation[]>();
    for (const [uuid, linkedUuids] of linkMap) {
      const resolved = linkedUuids
        .map((id) => annotationMap.get(id))
        .filter((a): a is CardboxAnnotation => a !== undefined);
      if (resolved.length > 0) map.set(uuid, resolved);
    }
    return map;
  }, [linkMap, annotationMap]);

  const handleRemoveLink = useCallback(
    (targetUuid: string) => {
      if (expandedUuid) removeLink(expandedUuid, targetUuid);
    },
    [expandedUuid, removeLink],
  );

  const handleLinkSelect = useCallback(
    (targetUuid: string) => {
      if (expandedUuid) addLink(expandedUuid, targetUuid);
    },
    [expandedUuid, addLink],
  );

  const existingLinksForExpanded = useMemo(() => {
    if (!expandedUuid) return [];
    return linkMap.get(expandedUuid) ?? [];
  }, [expandedUuid, linkMap]);

  const { gridRef, handleKeyDown: handleGridKeyDown } = useCardboxKeyboard({
    onExpand: (index) => {
      const ann = sortedAnnotations[index];
      if (ann) toggleExpand(ann.uuid);
    },
    onNavigate: (index) => {
      const ann = sortedAnnotations[index];
      if (ann) handleNavigate(ann);
    },
    onOpenLinkPicker: () => setLinkPickerOpen(true),
    expandedUuid,
    itemCount: sortedAnnotations.length,
  });

  const handleFocusCard = useCallback(
    (uuid: string) => {
      const el = gridRef.current?.querySelector(`[data-uuid="${uuid}"]`);
      if (!el) return;
      toggleExpand(uuid);
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    },
    [toggleExpand, gridRef],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Get current visible order as UUIDs
    const visibleIds = sortedAnnotations.map((a) => a.uuid);
    const oldIndex = visibleIds.indexOf(active.id as string);
    const newIndex = visibleIds.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    // Compute new full order
    const currentOrder = order.length > 0 ? [...order] : annotations.map((a) => a.uuid);
    const activeUuid = active.id as string;

    // Remove active from current order
    const withoutActive = currentOrder.filter((id) => id !== activeUuid);

    // Find where to insert: after the item that's now at the target position in visible list
    const newVisibleOrder = arrayMove(visibleIds, oldIndex, newIndex);
    // Find the item that comes before our moved item in the new visible order
    const insertAfterItem = newIndex > 0 ? newVisibleOrder[newIndex - 1] ?? null : null;

    let insertAt: number;
    if (insertAfterItem === null) {
      insertAt = 0;
    } else {
      insertAt = withoutActive.indexOf(insertAfterItem) + 1;
    }

    withoutActive.splice(insertAt, 0, activeUuid);
    setOrder(withoutActive);
    debouncedSave();
  }, [sortedAnnotations, order, annotations, setOrder, debouncedSave]);

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
                  activeTypes === null || activeTypes.has(type) ? "opacity-100" : "opacity-40"
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
        {sortedAnnotations.length === 0 ? (
          <div className="flex h-full items-center justify-center text-text-faint" data-testid="cardbox-no-results">
            No matching annotations
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortedAnnotations.map((a) => a.uuid)} strategy={rectSortingStrategy}>
              <div
                ref={gridRef}
                className="grid"
                style={{
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gridAutoRows: "8px",
                  columnGap: "1rem",
                  alignItems: "start",
                }}
                onKeyDown={handleGridKeyDown}
              >
                {sortedAnnotations.map((ann) => (
                  <SortableCard
                    key={ann.uuid}
                    annotation={ann}
                    expanded={expandedUuid === ann.uuid}
                    onToggleExpand={() => toggleExpand(ann.uuid)}
                    onNavigate={() => handleNavigate(ann)}
                    linkedCards={linkedCardsMap.get(ann.uuid) ?? EMPTY_LINKED}
                    onFocusCard={handleFocusCard}
                    onRemoveLink={handleRemoveLink}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 150, easing: "ease-out" }}>
              {activeId && annotations.find((a) => a.uuid === activeId) ? (
                <div className="opacity-90" style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.12)", transform: "scale(1.02)" }}>
                  <CardboxCard
                    annotation={annotations.find((a) => a.uuid === activeId)!}
                    expanded={false}
                    onToggleExpand={() => {}}
                    onNavigate={() => {}}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <LinkPicker
        open={linkPickerOpen}
        sourceUuid={expandedUuid ?? ""}
        annotations={annotations}
        existingLinks={existingLinksForExpanded}
        onSelect={handleLinkSelect}
        onClose={() => setLinkPickerOpen(false)}
      />
    </div>
  );
}
