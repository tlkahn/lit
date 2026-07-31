import { useEffect, useCallback, useMemo, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { showCardboxContextMenu, useCardboxContextMenu } from "../lib/contextMenuIpc";
import { useCardboxStore } from "../stores/cardbox";
import { usePaneLoadingStore } from "../stores/paneLoading";
import { usePaneStore } from "../stores/panes";
import { useCardboxUndoStore } from "../stores/cardboxUndo";
import { useStatusMessageStore } from "../stores/statusMessage";
import { useWorkspaceStore } from "../stores/workspace";
import { useCardboxKeyboard } from "../hooks/useCardboxKeyboard";
import { useCardboxSelection } from "../hooks/useCardboxSelection";
import { CardboxCardItem } from "./CardboxCardItem";
import { CardboxGroup } from "./CardboxGroup";
import { LinkPicker } from "./LinkPicker";
import { GroupPicker } from "./GroupPicker";
import { CardboxShortcutsOverlay } from "./CardboxShortcutsOverlay";
import { BatchToolbar } from "./BatchToolbar";
import type { CardboxAnnotation } from "../lib/ipc";
import { MasonryObserverProvider } from "../hooks/useMasonryObserver";
import { buildRenderEntries } from "../lib/buildRenderEntries";
import { resolveQuoteTarget } from "../lib/cardboxQuote";
import { perfMark, perfMeasure, perfTable } from "../lib/perf";
import { resolvePendingFocus, computeCenteredScrollTop, computeCollapseScrollTop, applyFocusHighlight } from "./cardboxFocus";
import { truncateBody } from "../editor/livePreview/annotationConstants";

const EMPTY_LINKED: CardboxAnnotation[] = [];

// Measure a card element against the cardbox grid's own scroll container for
// the compute*ScrollTop helpers. Scrolling must stay confined to that
// container — Element.scrollIntoView would also move scrollable ancestors and
// carry the PaneHeader out of view. Returns null when the card is no longer
// inside a grid (torn down mid-timeout).
function measureCardInGrid(el: Element): {
  scroller: HTMLElement;
  metrics: Parameters<typeof computeCenteredScrollTop>[0];
} | null {
  const scroller = el.closest<HTMLElement>("[data-testid='cardbox-grid']");
  if (!scroller) return null;
  const cardRect = el.getBoundingClientRect();
  const scRect = scroller.getBoundingClientRect();
  return {
    scroller,
    metrics: {
      scrollTop: scroller.scrollTop,
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
      cardOffsetTop: cardRect.top - scRect.top,
      cardHeight: cardRect.height,
    },
  };
}

export default function CardboxView({ pagePath }: { pagePath: string }) {
  const annotations = useCardboxStore((s) => s.annotations);
  const expandedUuid = useCardboxStore((s) => s.expandedUuid);
  const loading = useCardboxStore((s) => s.loading);
  const searchQuery = useCardboxStore((s) => s.searchQuery);
  const activeTypes = useCardboxStore((s) => s.activeTypes);
  const activeColors = useCardboxStore((s) => s.activeColors);
  const scope = useCardboxStore((s) => s.scope);
  const setScope = useCardboxStore((s) => s.setScope);
  const toggleColor = useCardboxStore((s) => s.toggleColor);
  const fetchAnnotations = useCardboxStore((s) => s.fetchAnnotations);
  const collapseAll = useCardboxStore((s) => s.collapseAll);
  const toggleExpand = useCardboxStore((s) => s.toggleExpand);
  const expand = useCardboxStore((s) => s.expand);
  const setSearchQuery = useCardboxStore((s) => s.setSearchQuery);
  const resetFilters = useCardboxStore((s) => s.resetFilters);
  const toggleType = useCardboxStore((s) => s.toggleType);
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
  const pinned = useCardboxStore((s) => s.pinned);
  const pinCard = useCardboxStore((s) => s.pinCard);
  const unpinCard = useCardboxStore((s) => s.unpinCard);
  const notes = useCardboxStore((s) => s.notes);
  const setNote = useCardboxStore((s) => s.setNote);
  const exportNote = useCardboxStore((s) => s.exportNote);
  const mergeToDraft = useCardboxStore((s) => s.mergeToDraft);
  const colors = useCardboxStore((s) => s.colors);
  const setCardColor = useCardboxStore((s) => s.setCardColor);
  const clearCardColor = useCardboxStore((s) => s.clearCardColor);
  const connectionsForUuid = useCardboxStore((s) => s.connectionsForUuid);
  const pendingFocusUuid = useCardboxStore((s) => s.pendingFocusUuid);
  const setPendingFocusUuid = useCardboxStore((s) => s.setPendingFocusUuid);
  const pendingNotePrefill = useCardboxStore((s) => s.pendingNotePrefill);
  const setPendingNotePrefill = useCardboxStore((s) => s.setPendingNotePrefill);
  const layoutLoaded = useCardboxStore((s) => s.layoutLoaded);
  const enterConnections = useCardboxStore((s) => s.enterConnections);
  const exitConnections = useCardboxStore((s) => s.exitConnections);
  const batchSetColor = useCardboxStore((s) => s.batchSetColor);
  const batchClearColor = useCardboxStore((s) => s.batchClearColor);
  const batchPin = useCardboxStore((s) => s.batchPin);
  const batchUnpin = useCardboxStore((s) => s.batchUnpin);
  const batchLink = useCardboxStore((s) => s.batchLink);
  const batchCreateGroup = useCardboxStore((s) => s.batchCreateGroup);
  const undo = useCardboxUndoStore((s) => s.undo);
  const redo = useCardboxUndoStore((s) => s.redo);
  const selectPageAtLine = useWorkspaceStore((s) => s.selectPageAtLine);
  const selectPage = useWorkspaceStore((s) => s.selectPage);

  const { selectedUuids, selectedCount, handleCardClick, selectAll, clearSelection } = useCardboxSelection();

  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [groupPickerCardUuid, setGroupPickerCardUuid] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mergingToDraft, setMergingToDraft] = useState(false);

  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);

  useEffect(() => {
    perfMark("cardbox:mount");
    fetchAnnotations()
      .then(() => {
        perfMeasure("cardbox:fetch", "cardbox:mount");
        return loadLayout();
      })
      .then(() => {
        perfMeasure("cardbox:load", "cardbox:mount");
      });
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
  }, [searchQuery, activeTypes, activeColors, scope, clearSelection]);

  // Mount-only: every cardbox open starts collapsed. User-initiated scope
  // changes collapse via handleScopeChange; programmatic setScope (e.g.
  // cross-page pending-focus widen) must NOT collapse (#972).
  useEffect(() => {
    collapseAll();
  }, [collapseAll]);

  const handleScopeChange = useCallback(
    (next: "document" | "workspace") => {
      collapseAll();
      setScope(next);
    },
    [collapseAll, setScope],
  );

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

  const documentAnnotations = useMemo(
    () => scope === "document"
      ? annotations.filter((a) => a.source_page_id === pagePath)
      : annotations,
    [annotations, pagePath, scope],
  );

  // Derive all unique types from annotations (for chips)
  const allTypes = useMemo(
    () => [...new Set(documentAnnotations.map((a) => a.annotation_type))].sort(),
    [documentAnnotations],
  );

  const usedColors = useMemo(
    () => [...new Set(documentAnnotations.map((a) => colors[a.uuid]).filter((c): c is string => !!c))].sort(),
    [documentAnnotations, colors],
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
      if (scope === "document" && ann.source_page_id !== pagePath) return false;
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
  }, [annotations, pagePath, scope, searchQuery, activeTypes, effectiveActiveColors, colors, pinnedSet, notes]);

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
    () => buildRenderEntries(effectiveAnnotations, groups, pinned),
    [effectiveAnnotations, groups, pinned],
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

  // lit-perf observability: measure mount → first non-empty card render once.
  const firstPaintRef = useRef(false);
  useEffect(() => {
    if (firstPaintRef.current || renderEntries.length === 0) return;
    firstPaintRef.current = true;
    perfMeasure("cardbox:first-paint", "cardbox:mount");
    perfTable("cardbox", [
      { label: "annotations", value: annotations.length, unit: "count" },
      { label: "render entries", value: renderEntries.length, unit: "count" },
    ]);
  }, [renderEntries, annotations.length]);

  // Read the ordering through a ref so handleSelect stays referentially stable
  // across reorders/filtering — otherwise every recompute of renderEntries
  // defeats memo() on all cards. The ref is current at event time (effects
  // flush before user events can fire).
  const orderedUuidsRef = useRef(orderedUuids);
  useEffect(() => {
    orderedUuidsRef.current = orderedUuids;
  });

  const handleSelect = useCallback(
    (uuid: string, event: React.MouseEvent) => {
      handleCardClick(uuid, event, orderedUuidsRef.current);
    },
    [handleCardClick],
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

  const handleNotePrefillConsumed = useCallback(
    () => setPendingNotePrefill(null),
    [setPendingNotePrefill],
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
      // getState() instead of the subscribed expandedUuid: depending on it
      // would give this callback a new identity on every expand/collapse,
      // defeating memo() on all cards. Store state at event time is what
      // matters — the click always comes from inside the expanded card.
      const { expandedUuid } = useCardboxStore.getState();
      if (expandedUuid) removeLink(expandedUuid, targetUuid);
    },
    [removeLink],
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
      const ann = annotationMap.get(orderedUuids[index] ?? "");
      if (ann) handleToggleExpand(ann.uuid);
    },
    onNavigate: (index) => {
      const ann = annotationMap.get(orderedUuids[index] ?? "");
      if (ann) handleNavigate(ann);
    },
    onOpenLinkPicker: () => setLinkPickerOpen(true),
    onTogglePin: (index) => {
      const ann = annotationMap.get(orderedUuids[index] ?? "");
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
    onToggleScope: () => { if (!connectionsForUuid) handleScopeChange(scope === "document" ? "workspace" : "document"); },
    onQuoteSelection: () => {
      const target = resolveQuoteTarget(window.getSelection(), gridRef.current);
      if (!target) return;
      expand(target.uuid);
      setPendingNotePrefill(target);
    },
    onUndo: async () => { await undo(); debouncedSave(); },
    onRedo: async () => { await redo(); debouncedSave(); },
    expandedUuid,
    connectionsActive: !!connectionsForUuid,
    itemCount: orderedUuids.length,
  });

  // Pending scroll/highlight delay from handleFocusCard; cleared on repeat
  // focus and on unmount so it never fires against a torn-down grid.
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending post-collapse visibility check from handleToggleExpand (#939);
  // same lifecycle rules as focusTimerRef.
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
  }, []);

  // Wraps the store's toggleExpand for every expand/collapse path (card click,
  // Escape, keyboard toggle, grouped cards). On collapse, once the 200ms
  // grid-template-rows transition settles, re-center the card within the grid's
  // own scroll container if it shrank out of view — the reader who scrolled
  // deep into a long expanded card would otherwise lose their place (#939).
  // A still-visible card scrolls nothing, and only the grid container ever
  // moves (never ancestors — same constraint as handleFocusCard).
  const handleToggleExpand = useCallback(
    (uuid: string) => {
      // getState(), not the subscribed expandedUuid: a reactive dep would give
      // this callback a new identity on every expand/collapse, defeating
      // memo() on all cards (#850).
      const collapsing = useCardboxStore.getState().expandedUuid === uuid;
      toggleExpand(uuid);
      if (!collapsing) return;
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = setTimeout(() => {
        const el = gridRef.current?.querySelector(`[data-uuid="${uuid}"]`);
        if (!el) return;
        const measured = measureCardInGrid(el);
        if (!measured) return;
        const top = computeCollapseScrollTop(measured.metrics);
        if (top !== null) measured.scroller.scrollTo({ top, behavior: "smooth" });
      }, 250); // 200ms collapse transition + buffer, matching handleFocusCard
    },
    [toggleExpand, gridRef],
  );

  const handleFocusCard = useCallback(
    (uuid: string, highlightNote = false) => {
      // Force-expand, never toggle: a card whose expandedUuid persisted from an
      // earlier cardbox visit must not collapse when navigated to (#957).
      expand(uuid);
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      focusTimerRef.current = setTimeout(() => {
        const el = gridRef.current?.querySelector(`[data-uuid="${uuid}"]`);
        if (!el) return;
        const measured = measureCardInGrid(el);
        if (measured) {
          const top = computeCenteredScrollTop(measured.metrics);
          measured.scroller.scrollTo({ top, behavior: "smooth" });
        }
        applyFocusHighlight(el as HTMLElement, { highlightNote });
      }, 250);
    },
    [expand, gridRef],
  );

  // Consume a pending focus request (set when the cardbox icon in an expanded
  // annotation is clicked). resolvePendingFocus decides the action: `wait` while
  // the target isn't in the current annotations yet (stale data, fetch in
  // flight); `clear` when annotations settled empty (drop the stale request);
  // or `focus` (optionally resetting filters first when the card is hidden).
  // Handles both a fresh mount and an already-open cardbox.
  useEffect(() => {
    // Read loading from the live store, not the render closure: the mount
    // effect's fetchAnnotations() synchronously sets loading=true, but effects
    // from the same commit still capture the pre-effect value (false).  Reading
    // getState() sees the update and correctly returns "wait" until the fetch
    // resolves with fresh annotations. layoutLoaded has no such same-commit
    // sync-set hazard (loadLayout only flips it after its awaits), so the plain
    // subscription suffices.
    const action = resolvePendingFocus({
      loading: useCardboxStore.getState().loading,
      layoutReady: layoutLoaded,
      pendingFocusUuid,
      annotationUuids: annotationMap,
      filteredUuids: filteredUuidSet,
      groups,
    });
    if (action.kind === "wait") return;
    // Capture before setPendingFocusUuid(null) resets the flag alongside the uuid.
    const highlightNote = useCardboxStore.getState().pendingHighlightNote;
    setPendingFocusUuid(null);
    if (action.kind === "focus") {
      // Cross-page target under document scope: the page filter hides the card
      // forever. Widen with raw setScope so we do NOT collapse (Cycle 2) (#972).
      const target = annotationMap.get(action.uuid);
      if (
        target &&
        target.source_page_id !== pagePath &&
        useCardboxStore.getState().scope === "document"
      ) {
        setScope("workspace");
      }
      // F2: the card is present but hidden by an active filter; reset filters so
      // it re-renders into the DOM before handleFocusCard's scroll/highlight.
      if (action.clearFilters) resetFilters();
      // F4: card lives in a collapsed group — expand it so the card mounts (#972).
      // toggleGroupCollapse persists via IPC; store update is sync.
      if (action.expandGroupId) void toggleGroupCollapse(action.expandGroupId);
      handleFocusCard(action.uuid, highlightNote);
    }
    // 'clear' (F3): pendingFocusUuid was already nulled above; nothing to focus.
  }, [loading, layoutLoaded, pendingFocusUuid, annotationMap, filteredUuidSet, groups, setPendingFocusUuid, resetFilters, handleFocusCard, pagePath, setScope, toggleGroupCollapse]);

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
      createGroup(groupId, "New Group", [cardUuid]);
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

  // ---------- Render ----------

  if (loading && annotations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-text-faint" data-testid="cardbox-loading">
        Loading annotations…
      </div>
    );
  }

  if (documentAnnotations.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-text-faint" data-testid="cardbox-empty">
        <span>{scope === "document" ? "No annotations in this document" : "No annotations in this workspace"}</span>
        {scope === "document" && annotations.length > 0 && (
          <button onClick={() => handleScopeChange("workspace")} className="text-xs text-interactive-accent hover:underline" data-testid="cardbox-show-all">
            Show all workspace cards
          </button>
        )}
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
              className="-ml-2 w-[calc(100%+0.5rem)] rounded border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-normal placeholder:text-text-faint outline-none focus:ring-1 focus:ring-interactive-accent"
              data-testid="cardbox-search"
            />
            <div className="flex items-center justify-between">
              <div className="text-xs text-text-faint" data-testid="cardbox-count">
                {filteredAnnotations.length === documentAnnotations.length
                  ? `${documentAnnotations.length} annotation${documentAnnotations.length !== 1 ? "s" : ""}${scope === "workspace" ? " (all documents)" : ""}`
                  : `${filteredAnnotations.length} of ${documentAnnotations.length} annotation${documentAnnotations.length !== 1 ? "s" : ""}${scope === "workspace" ? " (all documents)" : ""}`}
              </div>
              <div role="group" aria-label="Annotation scope" className="flex gap-0.5 rounded-md border border-border p-0.5" data-testid="cardbox-scope-toggle">
                <button
                  aria-pressed={scope === "document"}
                  className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                    scope === "document" ? "bg-bg-primary text-text-normal font-medium shadow-sm" : "text-text-faint hover:text-text-normal"
                  }`}
                  onClick={() => handleScopeChange("document")}
                  data-testid="scope-document"
                >
                  Document
                </button>
                <button
                  aria-pressed={scope === "workspace"}
                  className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                    scope === "workspace" ? "bg-bg-primary text-text-normal font-medium shadow-sm" : "text-text-faint hover:text-text-normal"
                  }`}
                  onClick={() => handleScopeChange("workspace")}
                  data-testid="scope-workspace"
                >
                  Workspace
                </button>
              </div>
            </div>
            {allTypes.length > 1 && (
              <div className="-ml-2 flex flex-wrap gap-1" data-testid="cardbox-type-chips">
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
          <MasonryObserverProvider>
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
                  <CardboxCardItem
                    key={entry.annotation.uuid}
                    annotation={entry.annotation}
                    expanded={expandedUuid === entry.annotation.uuid}
                    isPinned={pinnedSet.has(entry.annotation.uuid)}
                    colorTag={colors[entry.annotation.uuid]}
                    onToggleExpand={handleToggleExpand}
                    onNavigate={handleNavigate}
                    linkedCards={linkedCardsMap.get(entry.annotation.uuid) ?? EMPTY_LINKED}
                    onFocusCard={handleFocusCard}
                    onRemoveLink={handleRemoveLink}
                    note={notesMap[entry.annotation.uuid]}
                    notePrefill={
                      pendingNotePrefill?.uuid === entry.annotation.uuid
                        ? pendingNotePrefill.text
                        : undefined
                    }
                    onNotePrefillConsumed={handleNotePrefillConsumed}
                    onSetNote={handleSetNote}
                    onExportNote={handleExportNote}
                    onShowConnections={enterConnections}
                    onContextMenu={handleCardContextMenu}
                    onSelect={handleSelect}
                  />
                ) : (
                  <CardboxGroup
                    key={`group:${entry.groupId}`}
                    groupId={entry.groupId}
                    info={entry.info}
                    cards={entry.cards}
                    allFilteredCount={groups[entry.groupId]?.order.filter(uuid => annotationMap.has(uuid)).length ?? 0}
                    expandedUuid={expandedUuid}
                    linkedCardsMap={linkedCardsMap}
                    onToggleExpand={handleToggleExpand}
                    onNavigate={handleNavigate}
                    onFocusCard={handleFocusCard}
                    onRemoveLink={handleRemoveLink}
                    notesMap={notes}
                    notePrefill={pendingNotePrefill}
                    onNotePrefillConsumed={handleNotePrefillConsumed}
                    onSetNote={handleSetNote}
                    onExportNote={handleExportNote}
                    onShowConnections={enterConnections}
                    onToggleCollapse={toggleGroupCollapse}
                    onRename={renameGroup}
                    onCardContextMenu={handleGroupCardContextMenu}
                    onHeaderContextMenu={handleGroupHeaderContextMenu}
                    colors={colors}
                    onCardSelect={handleSelect}
                  />
                ),
              )}
            </div>
          </MasonryObserverProvider>
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
        mergingToDraft={mergingToDraft}
        onMergeToDraft={async () => {
          const uuids = [...selectedUuids];
          const paneId = usePaneStore.getState().focusedPaneId;
          setMergingToDraft(true);
          usePaneLoadingStore.getState().startLoading(paneId);
          try {
            const path = await mergeToDraft(uuids);
            selectPage(path);
            usePaneStore.getState().setPaneViewMode(paneId, "editor");
            useStatusMessageStore.getState().show(`Draft created: ${path.split("/").pop()}`);
            clearSelection();
          } catch {
            useStatusMessageStore.getState().show("Failed to create draft", "error");
          } finally {
            usePaneLoadingStore.getState().stopLoading(paneId);
            setMergingToDraft(false);
          }
        }}
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
