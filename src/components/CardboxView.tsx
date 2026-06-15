import { useEffect, useCallback, useMemo, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent, DragOverEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { showCardboxContextMenu, useCardboxContextMenu } from "../lib/contextMenuIpc";
import { useCardboxStore } from "../stores/cardbox";
import { useWorkspaceStore } from "../stores/workspace";
import { useCardboxKeyboard } from "../hooks/useCardboxKeyboard";
import { CardboxCard } from "./CardboxCard";
import { SortableCard } from "./SortableCard";
import { SortableGroup } from "./SortableGroup";
import { LinkPicker } from "./LinkPicker";
import { GroupPicker } from "./GroupPicker";
import { makeCardboxCollision } from "../lib/cardboxCollision";
import { parseActiveId, parseOverId } from "../lib/dndIds";
import type { ParsedActiveId } from "../lib/dndIds";
import type { CardboxAnnotation, GroupInfo } from "../lib/ipc";

const EMPTY_LINKED: CardboxAnnotation[] = [];

interface DragState {
  activeId: string;
  parsed: ParsedActiveId;
  overGroupId: string | null;
}

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
  const groups = useCardboxStore((s) => s.groups);
  const createGroup = useCardboxStore((s) => s.createGroup);
  const dissolveGroup = useCardboxStore((s) => s.dissolveGroup);
  const renameGroup = useCardboxStore((s) => s.renameGroup);
  const toggleGroupCollapse = useCardboxStore((s) => s.toggleGroupCollapse);
  const moveCardToGroup = useCardboxStore((s) => s.moveCardToGroup);
  const removeCardFromGroup = useCardboxStore((s) => s.removeCardFromGroup);
  const reorderWithinGroup = useCardboxStore((s) => s.reorderWithinGroup);
  const moveCardBetweenGroups = useCardboxStore((s) => s.moveCardBetweenGroups);
  const pinned = useCardboxStore((s) => s.pinned);
  const pinCard = useCardboxStore((s) => s.pinCard);
  const unpinCard = useCardboxStore((s) => s.unpinCard);
  const selectPageAtLine = useWorkspaceStore((s) => s.selectPageAtLine);

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [groupPickerCardUuid, setGroupPickerCardUuid] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const collisionDetection = useMemo(() => {
    if (!dragState) return makeCardboxCollision(null);
    const sourceGroupId = dragState.parsed.type === "groupCard" ? dragState.parsed.groupId : null;
    return makeCardboxCollision(sourceGroupId);
  }, [dragState]);

  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);

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
      // Pinned cards bypass search filter
      if (pinnedSet.has(ann.uuid)) return true;
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
  }, [annotations, searchQuery, activeTypes, pinnedSet]);

  // Visible pinned UUIDs: pinned cards that survived type filtering, in pinned-array order
  const visiblePinnedUuids = useMemo(() => {
    const filteredSet = new Set(filteredAnnotations.map((a) => a.uuid));
    return pinned.filter((uuid) => filteredSet.has(uuid));
  }, [filteredAnnotations, pinned]);

  // Sort filtered annotations by user's custom order (used for keyboard nav + DnD fallback)
  const sortedAnnotations = useMemo(() => {
    const annMap = new Map(filteredAnnotations.map((a) => [a.uuid, a]));
    const pinnedSection = visiblePinnedUuids
      .map((uuid) => annMap.get(uuid)!)
      .filter(Boolean);
    const pinnedUuids = new Set(visiblePinnedUuids);
    const unpinnedFiltered = filteredAnnotations.filter((a) => !pinnedUuids.has(a.uuid));
    if (order.length === 0) return [...pinnedSection, ...unpinnedFiltered];
    const orderMap = new Map(order.map((uuid, i) => [uuid, i]));
    const unpinnedSorted = [...unpinnedFiltered].sort((a, b) => {
      const ai = orderMap.get(a.uuid) ?? Infinity;
      const bi = orderMap.get(b.uuid) ?? Infinity;
      return ai - bi;
    });
    return [...pinnedSection, ...unpinnedSorted];
  }, [filteredAnnotations, order, visiblePinnedUuids]);

  // Build filtered UUID set for quick membership tests
  const filteredUuidSet = useMemo(
    () => new Set(filteredAnnotations.map((a) => a.uuid)),
    [filteredAnnotations],
  );

  const annotationMap = useMemo(() => {
    const map = new Map<string, CardboxAnnotation>();
    for (const ann of annotations) map.set(ann.uuid, ann);
    return map;
  }, [annotations]);

  // Two-tier render entries: bare cards + group containers
  type RenderEntry =
    | { kind: "card"; annotation: CardboxAnnotation }
    | { kind: "group"; groupId: string; info: GroupInfo; cards: CardboxAnnotation[] };

  const renderEntries = useMemo((): RenderEntry[] => {
    const entries: RenderEntry[] = [];
    for (const entry of order) {
      if (entry.startsWith("group:")) {
        const gid = entry.slice(6);
        const group = groups[gid];
        if (!group) continue;
        const groupAnns = group.order
          .map((uuid) => annotationMap.get(uuid))
          .filter((a): a is CardboxAnnotation => a !== undefined && filteredUuidSet.has(a.uuid));
        if (groupAnns.length > 0) {
          entries.push({ kind: "group", groupId: gid, info: group, cards: groupAnns });
        }
      } else {
        const ann = annotationMap.get(entry);
        if (ann && filteredUuidSet.has(ann.uuid)) {
          entries.push({ kind: "card", annotation: ann });
        }
      }
    }
    // Add any filtered annotations not present in order
    const inOrder = new Set(
      order.flatMap((e) => {
        if (e.startsWith("group:")) {
          const g = groups[e.slice(6)];
          return g ? g.order : [];
        }
        return [e];
      }),
    );
    for (const ann of filteredAnnotations) {
      if (!inOrder.has(ann.uuid)) {
        entries.push({ kind: "card", annotation: ann });
      }
    }
    return entries;
  }, [order, groups, annotationMap, filteredUuidSet, filteredAnnotations]);

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
    onTogglePin: (index) => {
      const ann = sortedAnnotations[index];
      if (ann) {
        if (pinnedSet.has(ann.uuid)) {
          unpinCard(ann.uuid);
        } else {
          pinCard(ann.uuid);
        }
      }
    },
    expandedUuid,
    itemCount: sortedAnnotations.length,
  });

  const handleFocusCard = useCallback(
    (uuid: string) => {
      toggleExpand(uuid);
      setTimeout(() => {
        const el = gridRef.current?.querySelector(`[data-uuid="${uuid}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("card-focus-highlight");
        void (el as HTMLElement).offsetWidth;
        el.classList.add("card-focus-highlight");
        el.addEventListener("animationend", () => el.classList.remove("card-focus-highlight"), { once: true });
      }, 250);
    },
    [toggleExpand, gridRef],
  );

  // ---------- Context menu handlers ----------

  const handleCardContextMenu = useCallback(
    (uuid: string, e: React.MouseEvent) => {
      e.preventDefault();
      showCardboxContextMenu({
        cardUuid: uuid,
        isPinned: pinnedSet.has(uuid),
        isGrouped: false,
        isGroupHeader: false,
        hasGroups: Object.keys(groups).length > 0,
      });
    },
    [groups, pinnedSet],
  );

  const handleGroupCardContextMenu = useCallback(
    (groupId: string, cardUuid: string, e: React.MouseEvent) => {
      e.preventDefault();
      showCardboxContextMenu({
        cardUuid,
        groupId,
        isPinned: pinnedSet.has(cardUuid),
        isGrouped: true,
        isGroupHeader: false,
        hasGroups: Object.keys(groups).length > 0,
      });
    },
    [groups, pinnedSet],
  );

  const handleGroupHeaderContextMenu = useCallback(
    (groupId: string, e: React.MouseEvent) => {
      e.preventDefault();
      showCardboxContextMenu({
        groupId,
        isPinned: false,
        isGroupHeader: true,
        isGrouped: false,
        hasGroups: Object.keys(groups).length > 0,
      });
    },
    [groups],
  );

  useCardboxContextMenu({
    onPin: (cardUuid) => { pinCard(cardUuid); debouncedSave(); },
    onUnpin: (cardUuid) => { unpinCard(cardUuid); debouncedSave(); },
    onNewGroup: (cardUuid) => {
      const groupId = crypto.randomUUID();
      createGroup(groupId, "New Group", [cardUuid], cardUuid);
      debouncedSave();
    },
    onAddToGroup: (cardUuid) => {
      const groupIds = Object.keys(groups);
      if (groupIds.length === 0) return;
      if (groupIds.length === 1) {
        moveCardToGroup(cardUuid, groupIds[0]!);
        debouncedSave();
        return;
      }
      setGroupPickerCardUuid(cardUuid);
    },
    onRemoveFromGroup: (cardUuid, groupId) => {
      removeCardFromGroup(cardUuid, groupId);
      debouncedSave();
    },
    onDissolveGroup: (groupId) => {
      dissolveGroup(groupId);
      debouncedSave();
    },
    onRenameGroup: (groupId) => {
      const el = document.querySelector(`[data-group-id="${groupId}"] [data-testid="group-name"]`);
      if (el) {
        el.dispatchEvent(new CustomEvent("lit:start-rename", { bubbles: false }));
      }
    },
  });

  // ---------- DnD event handlers ----------

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = event.active.id as string;
    setDragState({ activeId: id, parsed: parseActiveId(id), overGroupId: null });
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setDragState((prev) => prev ? { ...prev, overGroupId: null } : null);
      return;
    }
    const overId = over.id as string;
    if (overId.startsWith("droppable:group:")) {
      const groupId = overId.slice("droppable:group:".length);
      setDragState((prev) => prev ? { ...prev, overGroupId: groupId } : null);
    } else if (overId.startsWith("ingroup:")) {
      const rest = overId.slice("ingroup:".length);
      const sep = rest.indexOf(":");
      const groupId = sep >= 0 ? rest.slice(0, sep) : rest;
      setDragState((prev) => prev ? { ...prev, overGroupId: groupId } : null);
    } else {
      setDragState((prev) => prev ? { ...prev, overGroupId: null } : null);
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    setDragState(null);
  }, []);

  /**
   * Reorder at top level — works for cards and groups alike.
   * Moves `activeIdStr` to the position of `overIdStr` in visible order,
   * then maps that back to the full `order` array.
   */
  const reorderTopLevel = useCallback(
    (activeIdStr: string, overIdStr: string) => {
      const visibleIds = renderEntries.map((e) =>
        e.kind === "card" ? e.annotation.uuid : `group:${e.groupId}`,
      );
      const oldIndex = visibleIds.indexOf(activeIdStr);
      const newIndex = visibleIds.indexOf(overIdStr);
      if (oldIndex === -1 || newIndex === -1) return;

      const currentOrder = order.length > 0 ? [...order] : annotations.map((a) => a.uuid);
      const withoutActive = currentOrder.filter((id) => id !== activeIdStr);
      const newVisibleOrder = arrayMove(visibleIds, oldIndex, newIndex);
      const insertAfterItem = newIndex > 0 ? newVisibleOrder[newIndex - 1] ?? null : null;
      const insertAt = insertAfterItem === null ? 0 : withoutActive.indexOf(insertAfterItem) + 1;
      withoutActive.splice(insertAt, 0, activeIdStr);
      setOrder(withoutActive);
    },
    [renderEntries, order, annotations, setOrder],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragState(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const src = parseActiveId(active.id as string);
      const dst = parseOverId(over.id as string);

      // CASE 1: Group being dragged — top-level reorder only
      if (src.type === "group") {
        if (dst.type === "topCard" || dst.type === "group") {
          reorderTopLevel(`group:${src.groupId}`, over.id as string);
          debouncedSave();
        }
        return;
      }

      // CASE 2: Top-level card → top-level card (reorder)
      if (src.type === "topCard" && dst.type === "topCard") {
        reorderTopLevel(src.uuid, dst.uuid);
        debouncedSave();
        return;
      }

      // CASE 3: Top-level card → group drop zone
      if (src.type === "topCard" && dst.type === "groupDropZone") {
        moveCardToGroup(src.uuid, dst.groupId);
        debouncedSave();
        return;
      }

      // CASE 4: Top-level card → card inside a group (insert at that position)
      if (src.type === "topCard" && dst.type === "groupCard") {
        const group = groups[dst.groupId];
        const idx = group ? group.order.indexOf(dst.uuid) : undefined;
        moveCardToGroup(src.uuid, dst.groupId, idx != null && idx >= 0 ? idx : undefined);
        debouncedSave();
        return;
      }

      // CASE 5: Group card → group drop zone
      if (src.type === "groupCard" && dst.type === "groupDropZone") {
        if (src.groupId === dst.groupId) return; // same group, no-op
        moveCardBetweenGroups(src.uuid, src.groupId, dst.groupId);
        debouncedSave();
        return;
      }

      // CASE 6: Group card → group card
      if (src.type === "groupCard" && dst.type === "groupCard") {
        if (src.groupId === dst.groupId) {
          // Intra-group reorder
          reorderWithinGroup(src.groupId, src.uuid, dst.uuid);
          debouncedSave();
          return;
        }
        // Cross-group move
        const targetGroup = groups[dst.groupId];
        const idx = targetGroup ? targetGroup.order.indexOf(dst.uuid) : undefined;
        moveCardBetweenGroups(src.uuid, src.groupId, dst.groupId, idx != null && idx >= 0 ? idx : undefined);
        debouncedSave();
        return;
      }

      // CASE 7: Group card → top-level card or group entry (drag out of group)
      if (src.type === "groupCard" && (dst.type === "topCard" || dst.type === "group")) {
        // Guard: dropping on own group header is a no-op
        if (dst.type === "group" && src.groupId === dst.groupId) return;

        const currentOrder = order.length > 0 ? [...order] : annotations.map((a) => a.uuid);
        const overEntry = over.id as string;

        // Fix 4: account for auto-dissolve shifting indices
        const sourceGroup = groups[src.groupId];
        const willDissolve = sourceGroup != null && sourceGroup.order.length <= 1;
        let topLevelIndex: number | undefined;
        if (willDissolve) {
          // After dissolve, group:{gid} is removed — insert at the group's former position
          const groupPos = currentOrder.indexOf(`group:${src.groupId}`);
          topLevelIndex = groupPos >= 0 ? groupPos : undefined;
        } else {
          const pos = currentOrder.indexOf(overEntry);
          topLevelIndex = pos >= 0 ? pos : undefined;
        }
        removeCardFromGroup(src.uuid, src.groupId, topLevelIndex);
        debouncedSave();
        return;
      }

      // CASE 8: Top-level card → group entry (top-level reorder past a group)
      if (src.type === "topCard" && dst.type === "group") {
        reorderTopLevel(src.uuid, `group:${dst.groupId}`);
        debouncedSave();
        return;
      }
    },
    [
      groups,
      order,
      annotations,
      renderEntries,
      reorderTopLevel,
      moveCardToGroup,
      removeCardFromGroup,
      reorderWithinGroup,
      moveCardBetweenGroups,
      debouncedSave,
    ],
  );

  const handleGroupPickerSelect = useCallback(
    (groupId: string) => {
      if (groupPickerCardUuid) {
        moveCardToGroup(groupPickerCardUuid, groupId);
        debouncedSave();
      }
      setGroupPickerCardUuid(null);
    },
    [groupPickerCardUuid, moveCardToGroup, debouncedSave],
  );

  // ---------- Drag overlay helpers ----------

  /** Look up annotation for overlay rendering, supports both top-level and ingroup IDs. */
  const overlayAnnotation = useMemo(() => {
    if (!dragState) return null;
    const { parsed } = dragState;
    if (parsed.type === "topCard") return annotationMap.get(parsed.uuid) ?? null;
    if (parsed.type === "groupCard") return annotationMap.get(parsed.uuid) ?? null;
    return null;
  }, [dragState, annotationMap]);

  /** Group info for overlay when dragging a group. */
  const overlayGroup = useMemo(() => {
    if (!dragState || dragState.parsed.type !== "group") return null;
    const info = groups[dragState.parsed.groupId];
    if (!info) return null;
    return { name: info.name, cardCount: info.order.length };
  }, [dragState, groups]);

  // ---------- Render ----------

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
        {renderEntries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-text-faint" data-testid="cardbox-no-results">
            No matching annotations
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={renderEntries.map((e) =>
                e.kind === "card" ? e.annotation.uuid : `group:${e.groupId}`,
              )}
              strategy={rectSortingStrategy}
            >
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
                {renderEntries.map((entry) =>
                  entry.kind === "card" ? (
                    <SortableCard
                      key={entry.annotation.uuid}
                      annotation={entry.annotation}
                      expanded={expandedUuid === entry.annotation.uuid}
                      isPinned={pinnedSet.has(entry.annotation.uuid)}
                      onToggleExpand={() => toggleExpand(entry.annotation.uuid)}
                      onNavigate={() => handleNavigate(entry.annotation)}
                      linkedCards={linkedCardsMap.get(entry.annotation.uuid) ?? EMPTY_LINKED}
                      onFocusCard={handleFocusCard}
                      onRemoveLink={handleRemoveLink}
                      onContextMenu={(e) => handleCardContextMenu(entry.annotation.uuid, e)}
                    />
                  ) : (
                    <SortableGroup
                      key={`group:${entry.groupId}`}
                      groupId={entry.groupId}
                      info={entry.info}
                      cards={entry.cards}
                      allFilteredCount={groups[entry.groupId]?.order.filter(uuid => annotationMap.has(uuid)).length ?? 0}
                      expandedUuid={expandedUuid}
                      linkedCardsMap={linkedCardsMap}
                      isDropTarget={dragState?.overGroupId === entry.groupId}
                      onToggleExpand={toggleExpand}
                      onNavigate={handleNavigate}
                      onFocusCard={handleFocusCard}
                      onRemoveLink={handleRemoveLink}
                      onToggleCollapse={() => toggleGroupCollapse(entry.groupId)}
                      onRename={(name: string) => renameGroup(entry.groupId, name)}
                      onCardContextMenu={(cardUuid, e) => handleGroupCardContextMenu(entry.groupId, cardUuid, e)}
                      onHeaderContextMenu={(e) => handleGroupHeaderContextMenu(entry.groupId, e)}
                    />
                  ),
                )}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 150, easing: "ease-out" }}>
              {overlayAnnotation ? (
                <div className="opacity-90" style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.12)", transform: "scale(1.02)" }}>
                  <CardboxCard
                    annotation={overlayAnnotation}
                    expanded={false}
                    isPinned={pinnedSet.has(overlayAnnotation.uuid)}
                    onToggleExpand={() => {}}
                    onNavigate={() => {}}
                  />
                </div>
              ) : overlayGroup ? (
                <div className="rounded bg-bg-secondary px-3 py-2 shadow-lg border border-border">
                  <span className="text-sm font-medium">{overlayGroup.name}</span>
                  <span className="ml-2 text-xs text-text-muted">{overlayGroup.cardCount} cards</span>
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

      <GroupPicker
        open={groupPickerCardUuid !== null}
        groups={groups}
        onSelect={handleGroupPickerSelect}
        onClose={() => setGroupPickerCardUuid(null)}
      />
    </div>
  );
}
