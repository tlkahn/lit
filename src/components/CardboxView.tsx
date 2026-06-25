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
import type { BatchMoveTarget } from "../stores/cardbox";
import { useCardboxUndoStore } from "../stores/cardboxUndo";
import { useStatusMessageStore } from "../stores/statusMessage";
import { useWorkspaceStore } from "../stores/workspace";
import { useCardboxKeyboard } from "../hooks/useCardboxKeyboard";
import { useCardboxSelection } from "../hooks/useCardboxSelection";
import { CardboxCard } from "./CardboxCard";
import { SortableCard } from "./SortableCard";
import { SortableGroup } from "./SortableGroup";
import { LinkPicker } from "./LinkPicker";
import { GroupPicker } from "./GroupPicker";
import { CardboxShortcutsOverlay } from "./CardboxShortcutsOverlay";
import { BatchToolbar } from "./BatchToolbar";
import { makeCardboxCollision } from "../lib/cardboxCollision";
import { parseActiveId, parseOverId } from "../lib/dndIds";
import type { ParsedActiveId, ParsedOverId } from "../lib/dndIds";
import type { CardboxAnnotation } from "../lib/ipc";
import { DraggedUuidsContext } from "./DraggedUuidsContext";
import { buildRenderEntries } from "../lib/buildRenderEntries";
import { truncateBody } from "../editor/livePreview/annotationConstants";

const EMPTY_LINKED: CardboxAnnotation[] = [];

interface DragState {
  activeId: string;
  parsed: ParsedActiveId;
  overGroupId: string | null;
  draggedUuids: string[];
}

export default function CardboxView({ pagePath }: { pagePath: string }) {
  const annotations = useCardboxStore((s) => s.annotations);
  const expandedUuid = useCardboxStore((s) => s.expandedUuid);
  const loading = useCardboxStore((s) => s.loading);
  const searchQuery = useCardboxStore((s) => s.searchQuery);
  const activeTypes = useCardboxStore((s) => s.activeTypes);
  const activeColors = useCardboxStore((s) => s.activeColors);
  const toggleColor = useCardboxStore((s) => s.toggleColor);
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
  const notes = useCardboxStore((s) => s.notes);
  const setNote = useCardboxStore((s) => s.setNote);
  const exportNote = useCardboxStore((s) => s.exportNote);
  const colors = useCardboxStore((s) => s.colors);
  const setCardColor = useCardboxStore((s) => s.setCardColor);
  const clearCardColor = useCardboxStore((s) => s.clearCardColor);
  const connectionsForUuid = useCardboxStore((s) => s.connectionsForUuid);
  const enterConnections = useCardboxStore((s) => s.enterConnections);
  const exitConnections = useCardboxStore((s) => s.exitConnections);
  const batchSetColor = useCardboxStore((s) => s.batchSetColor);
  const batchClearColor = useCardboxStore((s) => s.batchClearColor);
  const batchPin = useCardboxStore((s) => s.batchPin);
  const batchUnpin = useCardboxStore((s) => s.batchUnpin);
  const batchLink = useCardboxStore((s) => s.batchLink);
  const batchMoveCards = useCardboxStore((s) => s.batchMoveCards);
  const batchCreateGroup = useCardboxStore((s) => s.batchCreateGroup);
  const undo = useCardboxUndoStore((s) => s.undo);
  const redo = useCardboxUndoStore((s) => s.redo);
  const selectPageAtLine = useWorkspaceStore((s) => s.selectPageAtLine);

  const { selectedUuids, selectedCount, handleCardClick, selectAll, clearSelection } = useCardboxSelection();

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [groupPickerCardUuid, setGroupPickerCardUuid] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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
    useCardboxUndoStore.getState().clear();
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
    clearSelection();
  }, [searchQuery, activeTypes, activeColors, clearSelection]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("lit:graph-updated", () => {
      fetchAnnotations().then(() => clearSelection());
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [fetchAnnotations, clearSelection]);

  const handleNavigate = useCallback((ann: CardboxAnnotation) => {
    window.dispatchEvent(new CustomEvent("lit:set-view-mode", { detail: "editor" }));
    selectPageAtLine(ann.source_page_id, ann.source_line);
  }, [selectPageAtLine]);

  // Derive all unique types from annotations (for chips)
  const allTypes = useMemo(
    () => [...new Set(annotations.map((a) => a.annotation_type))].sort(),
    [annotations],
  );

  const usedColors = useMemo(
    () => [...new Set(Object.values(colors))].sort(),
    [colors],
  );

  const effectiveActiveColors = useMemo(() => {
    if (activeColors === null) return null;
    const usedSet = new Set(usedColors);
    const pruned = new Set([...activeColors].filter((c) => usedSet.has(c)));
    return pruned.size > 0 ? pruned : null;
  }, [activeColors, usedColors]);

  // Combined filter pipeline
  const filteredAnnotations = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return annotations.filter((ann) => {
      if (ann.source_page_id !== pagePath) return false;
      // Type filter (null = not initialized yet, show all; empty set = user deselected all, show none)
      if (activeTypes !== null && activeTypes.size > 0 && !activeTypes.has(ann.annotation_type)) return false;
      if (activeTypes !== null && activeTypes.size === 0) return false;
      // Color filter (null = no filter; non-null = show only cards with a matching color tag)
      if (effectiveActiveColors !== null) {
        const c = colors[ann.uuid];
        if (!c || !effectiveActiveColors.has(c)) return false;
      }
      // Pinned cards bypass search filter
      if (pinnedSet.has(ann.uuid)) return true;
      // Search filter
      if (query) {
        const searchable = [ann.body, ann.original, ann.source_page_title, notes[ann.uuid]?.body]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!searchable.includes(query)) return false;
      }
      return true;
    });
  }, [annotations, pagePath, searchQuery, activeTypes, effectiveActiveColors, colors, pinnedSet, notes]);

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

  const connectionsUuidSet = useMemo(() => {
    if (!connectionsForUuid) return null;
    const uuidSet = new Set<string>();
    uuidSet.add(connectionsForUuid);
    const linked = linkMap.get(connectionsForUuid);
    if (linked) for (const uuid of linked) uuidSet.add(uuid);
    for (const group of Object.values(groups)) {
      if (group.order.includes(connectionsForUuid)) {
        for (const uuid of group.order) uuidSet.add(uuid);
      }
    }
    return uuidSet;
  }, [connectionsForUuid, linkMap, groups]);

  const effectiveAnnotations = useMemo(
    () => connectionsUuidSet
      ? filteredAnnotations.filter((a) => connectionsUuidSet.has(a.uuid))
      : filteredAnnotations,
    [filteredAnnotations, connectionsUuidSet],
  );

  // Visible pinned UUIDs: pinned cards that survived type filtering, in pinned-array order
  const visiblePinnedUuids = useMemo(() => {
    const filteredSet = new Set(effectiveAnnotations.map((a) => a.uuid));
    return pinned.filter((uuid) => filteredSet.has(uuid));
  }, [effectiveAnnotations, pinned]);

  // Sort filtered annotations by user's custom order (used for keyboard nav + DnD fallback)
  const sortedAnnotations = useMemo(() => {
    const annMap = new Map(effectiveAnnotations.map((a) => [a.uuid, a]));
    const pinnedSection = visiblePinnedUuids
      .map((uuid) => annMap.get(uuid)!)
      .filter(Boolean);
    const pinnedUuids = new Set(visiblePinnedUuids);
    const unpinnedFiltered = effectiveAnnotations.filter((a) => !pinnedUuids.has(a.uuid));
    if (order.length === 0) return [...pinnedSection, ...unpinnedFiltered];
    const orderMap = new Map(order.map((uuid, i) => [uuid, i]));
    const unpinnedSorted = [...unpinnedFiltered].sort((a, b) => {
      const ai = orderMap.get(a.uuid) ?? Infinity;
      const bi = orderMap.get(b.uuid) ?? Infinity;
      return ai - bi;
    });
    return [...pinnedSection, ...unpinnedSorted];
  }, [effectiveAnnotations, order, visiblePinnedUuids]);

  // Build filtered UUID set for quick membership tests
  const filteredUuidSet = useMemo(
    () => new Set(effectiveAnnotations.map((a) => a.uuid)),
    [effectiveAnnotations],
  );

  const annotationMap = useMemo(() => {
    const map = new Map<string, CardboxAnnotation>();
    for (const ann of annotations) map.set(ann.uuid, ann);
    return map;
  }, [annotations]);

  const renderEntries = useMemo(
    () => buildRenderEntries(order, groups, annotationMap, filteredUuidSet, effectiveAnnotations, pinned),
    [order, groups, annotationMap, filteredUuidSet, effectiveAnnotations, pinned],
  );

  const orderedUuids = useMemo(
    () => renderEntries.flatMap((e) =>
      e.kind === "card"
        ? [e.annotation.uuid]
        : e.info.collapsed
          ? []
          : e.cards.map((c) => c.uuid),
    ),
    [renderEntries],
  );

  const handleSelect = useCallback(
    (uuid: string, event: React.MouseEvent) => {
      handleCardClick(uuid, event, orderedUuids);
    },
    [handleCardClick, orderedUuids],
  );

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

  const notesMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [uuid, note] of Object.entries(notes)) {
      map[uuid] = note.body;
    }
    return map;
  }, [notes]);

  const handleSetNote = useCallback(
    (uuid: string, body: string) => {
      setNote(uuid, body);
    },
    [setNote],
  );

  const handleExportNote = useCallback(
    async (uuid: string) => {
      try {
        const path = await exportNote(uuid);
        useStatusMessageStore.getState().show(`Note exported to ${path}`);
      } catch {
        useStatusMessageStore.getState().show("Failed to export note", "error");
      }
    },
    [exportNote],
  );

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
    onToggleNote: () => {
      if (!expandedUuid) return;
      const card = gridRef.current?.querySelector(`[data-uuid="${expandedUuid}"]`);
      if (!card) return;
      const textarea = card.querySelector<HTMLTextAreaElement>('[data-testid="card-note-textarea"]');
      if (textarea) {
        textarea.focus();
        return;
      }
      const trigger =
        card.querySelector<HTMLButtonElement>('[data-testid="card-note-add"]') ??
        card.querySelector<HTMLButtonElement>('[data-testid="card-note-edit"]');
      if (trigger) {
        trigger.click();
      }
    },
    onShowConnections: () => {
      if (expandedUuid) enterConnections(expandedUuid);
    },
    onExitConnections: () => exitConnections(),
    onShowShortcuts: () => setShortcutsOpen(true),
    onSelectAll: () => selectAll(orderedUuids),
    onClearSelection: clearSelection,
    onUndo: async () => { await undo(); debouncedSave(); },
    onRedo: async () => { await redo(); debouncedSave(); },
    expandedUuid,
    connectionsActive: !!connectionsForUuid,
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
        currentColor: colors[uuid],
        isPinned: pinnedSet.has(uuid),
        isGrouped: false,
        isGroupHeader: false,
        hasGroups: Object.keys(groups).length > 0,
      });
    },
    [groups, pinnedSet, colors],
  );

  const handleGroupCardContextMenu = useCallback(
    (groupId: string, cardUuid: string, e: React.MouseEvent) => {
      e.preventDefault();
      showCardboxContextMenu({
        cardUuid,
        groupId,
        currentColor: colors[cardUuid],
        isPinned: pinnedSet.has(cardUuid),
        isGrouped: true,
        isGroupHeader: false,
        hasGroups: Object.keys(groups).length > 0,
      });
    },
    [groups, pinnedSet, colors],
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
    onPin: (cardUuid) => {
      if (selectedUuids.has(cardUuid) && selectedCount > 1) {
        batchPin([...selectedUuids]);
      } else {
        pinCard(cardUuid);
      }
      debouncedSave();
    },
    onUnpin: (cardUuid) => {
      if (selectedUuids.has(cardUuid) && selectedCount > 1) {
        batchUnpin([...selectedUuids]);
      } else {
        unpinCard(cardUuid);
      }
      debouncedSave();
    },
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
    onSetColor: (cardUuid, color) => {
      if (selectedUuids.has(cardUuid) && selectedCount > 1) {
        const uuids = [...selectedUuids];
        if (color) {
          batchSetColor(uuids, color);
        } else {
          batchClearColor(uuids);
        }
      } else {
        if (color) {
          setCardColor(cardUuid, color);
        } else {
          clearCardColor(cardUuid);
        }
      }
      debouncedSave();
    },
  });

  // ---------- DnD event handlers ----------

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = event.active.id as string;
    const parsed = parseActiveId(id);
    const cardUuid = parsed.type === "topCard" ? parsed.uuid : parsed.type === "groupCard" ? parsed.uuid : null;
    if (cardUuid && selectedUuids.has(cardUuid) && selectedUuids.size >= 2) {
      setDragState({ activeId: id, parsed, overGroupId: null, draggedUuids: [...selectedUuids] });
    } else {
      setDragState({ activeId: id, parsed, overGroupId: null, draggedUuids: cardUuid ? [cardUuid] : [] });
      clearSelection();
    }
  }, [clearSelection, selectedUuids]);

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

  const computeBatchTarget = useCallback(
    (dst: ParsedOverId, overIdStr: string): BatchMoveTarget | null => {
      if (dst.type === "topCard" || dst.type === "group") {
        const visibleIds = renderEntries.map((e) =>
          e.kind === "card" ? e.annotation.uuid : `group:${e.groupId}`,
        );
        const visIdx = visibleIds.indexOf(overIdStr);
        if (visIdx === -1) return null;
        const currentOrder = order.length > 0 ? [...order] : annotations.map((a) => a.uuid);
        const insertAfterItem = visIdx > 0 ? visibleIds[visIdx - 1] ?? null : null;
        const insertAtIndex = insertAfterItem === null ? 0 : currentOrder.indexOf(insertAfterItem) + 1;
        return { type: "topLevel", insertAtIndex };
      }
      if (dst.type === "groupDropZone") {
        return { type: "toGroup", groupId: dst.groupId };
      }
      if (dst.type === "groupCard") {
        const group = groups[dst.groupId];
        const idx = group ? group.order.indexOf(dst.uuid) : undefined;
        return { type: "toGroup", groupId: dst.groupId, index: idx != null && idx >= 0 ? idx : undefined };
      }
      return null;
    },
    [renderEntries, order, annotations, groups],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const prevDragState = dragState;
      setDragState(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      // Multi-card drag path
      if (prevDragState && prevDragState.draggedUuids.length > 1) {
        const dst = parseOverId(over.id as string);
        const target = computeBatchTarget(dst, over.id as string);
        if (target) {
          batchMoveCards(prevDragState.draggedUuids, target);
          clearSelection();
          debouncedSave();
        }
        return;
      }

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
      dragState,
      groups,
      order,
      annotations,
      renderEntries,
      reorderTopLevel,
      moveCardToGroup,
      removeCardFromGroup,
      reorderWithinGroup,
      moveCardBetweenGroups,
      batchMoveCards,
      clearSelection,
      computeBatchTarget,
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

  const draggedUuidsSet = useMemo(
    () => dragState ? new Set(dragState.draggedUuids) : new Set<string>(),
    [dragState],
  );

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
        {connectionsForUuid ? (
          <>
            <div className="flex items-center gap-2" data-testid="cardbox-breadcrumb">
              <span className="text-sm text-text-muted">Connections for:</span>
              <span className="truncate text-sm font-medium text-text-normal">
                {(() => { const ann = annotationMap.get(connectionsForUuid); return truncateBody(ann?.body || ann?.original || null); })()}
              </span>
              <button
                onClick={() => exitConnections()}
                className="ml-auto shrink-0 rounded p-0.5 text-text-faint hover:text-text-normal"
                aria-label="Exit connections view"
                data-testid="cardbox-breadcrumb-exit"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
              </button>
            </div>
            <div className="text-xs text-text-faint" data-testid="cardbox-count">
              {effectiveAnnotations.length} connected card{effectiveAnnotations.length !== 1 ? "s" : ""}
            </div>
          </>
        ) : (
          <>
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
            {usedColors.length >= 2 && (
              <div className="flex flex-wrap gap-1" data-testid="cardbox-color-chips">
                {usedColors.map((color) => (
                  <button
                    key={color}
                    onClick={() => toggleColor(color)}
                    className="h-5 w-5 rounded-full border border-border transition-opacity duration-150"
                    style={{
                      backgroundColor: `rgba(var(--chip-${color}), 0.6)`,
                      opacity: effectiveActiveColors === null || effectiveActiveColors.has(color) ? 1 : 0.3,
                    }}
                    data-testid={`color-chip-${color}`}
                    aria-label={`Filter by ${color}`}
                  />
                ))}
              </div>
            )}
            <div className="text-xs text-text-faint" data-testid="cardbox-count">
              {filteredAnnotations.length === annotations.length
                ? `${annotations.length} annotations`
                : `${filteredAnnotations.length} of ${annotations.length} annotations`}
            </div>
          </>
        )}
      </div>

      {/* Card grid */}
      <div className="flex-1 overflow-y-auto p-6" data-testid="cardbox-grid">
        {renderEntries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-text-faint" data-testid="cardbox-no-results">
            No matching annotations
          </div>
        ) : (
          <DraggedUuidsContext.Provider value={draggedUuidsSet}>
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
                      colorTag={colors[entry.annotation.uuid]}
                      onToggleExpand={() => toggleExpand(entry.annotation.uuid)}
                      onNavigate={() => handleNavigate(entry.annotation)}
                      linkedCards={linkedCardsMap.get(entry.annotation.uuid) ?? EMPTY_LINKED}
                      onFocusCard={handleFocusCard}
                      onRemoveLink={handleRemoveLink}
                      note={notesMap[entry.annotation.uuid]}
                      onSetNote={(body: string) => handleSetNote(entry.annotation.uuid, body)}
                      onExportNote={() => handleExportNote(entry.annotation.uuid)}
                      onShowConnections={() => enterConnections(entry.annotation.uuid)}
                      onContextMenu={(e) => handleCardContextMenu(entry.annotation.uuid, e)}
                      onSelect={handleSelect}
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
                      notesMap={notes}
                      onSetNote={handleSetNote}
                      onExportNote={handleExportNote}
                      onShowConnections={(uuid: string) => enterConnections(uuid)}
                      onToggleCollapse={() => toggleGroupCollapse(entry.groupId)}
                      onRename={(name: string) => renameGroup(entry.groupId, name)}
                      onCardContextMenu={(cardUuid, e) => handleGroupCardContextMenu(entry.groupId, cardUuid, e)}
                      onHeaderContextMenu={(e) => handleGroupHeaderContextMenu(entry.groupId, e)}
                      colors={colors}
                      onCardSelect={handleSelect}
                    />
                  ),
                )}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 150, easing: "ease-out" }}>
              {overlayAnnotation ? (
                dragState && dragState.draggedUuids.length > 1 ? (
                  <div className="relative" style={{ transform: "scale(1.02)" }}>
                    <div className="absolute inset-0 rounded-lg bg-bg-secondary border border-border" style={{ transform: "translate(8px, 8px)", opacity: 0.4 }} />
                    {dragState.draggedUuids.length > 2 && (
                      <div className="absolute inset-0 rounded-lg bg-bg-secondary border border-border" style={{ transform: "translate(4px, 4px)", opacity: 0.6 }} />
                    )}
                    <div className="relative opacity-90" style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
                      <CardboxCard
                        annotation={overlayAnnotation}
                        expanded={false}
                        isPinned={pinnedSet.has(overlayAnnotation.uuid)}
                        colorTag={colors[overlayAnnotation.uuid]}
                        onToggleExpand={() => {}}
                        onNavigate={() => {}}
                      />
                    </div>
                    <div
                      className="absolute flex items-center justify-center rounded-full bg-interactive-accent text-on-accent text-xs font-bold"
                      style={{ top: -8, right: -8, width: 24, height: 24, zIndex: 1 }}
                    >
                      {dragState.draggedUuids.length}
                    </div>
                  </div>
                ) : (
                  <div className="opacity-90" style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.12)", transform: "scale(1.02)" }}>
                    <CardboxCard
                      annotation={overlayAnnotation}
                      expanded={false}
                      isPinned={pinnedSet.has(overlayAnnotation.uuid)}
                      colorTag={colors[overlayAnnotation.uuid]}
                      onToggleExpand={() => {}}
                      onNavigate={() => {}}
                    />
                  </div>
                )
              ) : overlayGroup ? (
                <div className="rounded bg-bg-secondary px-3 py-2 shadow-lg border border-border">
                  <span className="text-sm font-medium">{overlayGroup.name}</span>
                  <span className="ml-2 text-xs text-text-muted">{overlayGroup.cardCount} cards</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          </DraggedUuidsContext.Provider>
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

      <CardboxShortcutsOverlay
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      <BatchToolbar
        selectedCount={selectedCount}
        onGroup={() => {
          const uuids = [...selectedUuids];
          batchCreateGroup(uuids, "New Group");
          clearSelection();
          debouncedSave();
        }}
        onLinkAll={() => {
          const uuids = [...selectedUuids];
          batchLink(uuids);
          clearSelection();
          debouncedSave();
        }}
        onSetColor={(color) => {
          const uuids = [...selectedUuids];
          batchSetColor(uuids, color);
          clearSelection();
          debouncedSave();
        }}
        onClearColor={() => {
          const uuids = [...selectedUuids];
          batchClearColor(uuids);
          clearSelection();
          debouncedSave();
        }}
        onPin={() => {
          const uuids = [...selectedUuids];
          batchPin(uuids);
          clearSelection();
          debouncedSave();
        }}
        onUnpin={() => {
          const uuids = [...selectedUuids];
          batchUnpin(uuids);
          clearSelection();
          debouncedSave();
        }}
        onClear={clearSelection}
      />
    </div>
  );
}
