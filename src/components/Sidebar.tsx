import { useState, useRef, useEffect, useMemo, useDeferredValue, useCallback, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useWorkspaceStore } from "../stores/workspace";
import { usePreferencesStore } from "../stores/preferences";
import { useStatusMessageStore } from "../stores/statusMessage";
import { openInExternalEditor } from "../lib/ipc";
import { ensureSidebarVisible } from "../lib/sidebarVisibility";
import {
  onRevealInFileTree,
  onSetSidebarTab,
  onRevealBibEntry,
  onRevealBibEntryForPage,
  dispatchRevealBibEntry,
  dispatchRevealBibEntryForPage,
} from "../lib/sidebarEvents";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { join } from "@tauri-apps/api/path";
import { showSidebarContextMenu, useSidebarContextMenu } from "../lib/contextMenuIpc";
import { executeCommand } from "../lib/commandRegistry";
import { localeFilter } from "../lib/localeSearch";
import { useSidebarTab } from "../hooks/useSidebarTab";
import { useFlatTree, type FolderNode } from "../hooks/useFlatTree";
import { useSidebarSort } from "../hooks/useSidebarSort";
import { useRevealFlash } from "../hooks/useRevealFlash";
import { useTreeKeyboard } from "../hooks/useTreeKeyboard";
import { useFileTreeSelectionStore } from "../stores/fileTreeSelection";
import { visiblePagePaths, nextFocusKey } from "../lib/fileTreeTrash";
import { Outline } from "./Outline";
import { ReferenceLibrary } from "./ReferenceLibrary";
import { SearchPanel } from "./SearchPanel";
import { useSidebarLayoutStore, MIN_SIDEBAR_WIDTH_PX, SIDEBAR_MAX_WIDTH_RATIO } from "../stores/sidebarLayout";
import { useSidebarPosition } from "../hooks/useSidebarPosition";
import { ResizeHandle } from "./ResizeHandle";
import { useSearchPanelStore } from "../stores/searchPanel";
import { SortDropdown } from "./SortDropdown";
import { TrashPagesDialog } from "./TrashPagesDialog";
import type { PageMeta } from "../lib/ipc";

function buildTree(pages: PageMeta[]): FolderNode {
  const root: FolderNode = { name: "", pages: [], children: new Map() };
  for (const page of pages) {
    const parts = page.relative_path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i]!;
      if (!node.children.has(dir)) {
        node.children.set(dir, { name: dir, pages: [], children: new Map() });
      }
      node = node.children.get(dir)!;
    }
    node.pages.push(page);
  }
  return root;
}

const PageItem = memo(function PageItem({
  id,
  page,
  isActive,
  isSelected,
  isRenaming,
  isRevealed,
  isFocused,
  onSelect,
  onToggleSelect,
  onRangeSelect,
  onPlainSelect,
  onRenameCommit,
  onRenameCancel,
  depth,
}: {
  id?: string;
  page: PageMeta;
  isActive: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  isRevealed: boolean;
  isFocused: boolean;
  onSelect: (path: string) => void;
  onToggleSelect: (path: string) => void;
  onRangeSelect: (path: string) => void;
  onPlainSelect: (path: string) => void;
  onRenameCommit: (path: string, newName: string) => void;
  onRenameCancel: () => void;
  depth: number;
}) {
  const [renameValue, setRenameValue] = useState(page.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(page.title);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isRenaming, page.title]);

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== page.title) {
      onRenameCommit(page.relative_path, trimmed);
    } else {
      onRenameCancel();
    }
  };

  return (
    <div
      id={id}
      className="group relative"
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isSelected}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!isRenaming) {
          const selected = useFileTreeSelectionStore.getState().selectedPaths;
          const count =
            selected.size > 1 && selected.has(page.relative_path) ? selected.size : 1;
          showSidebarContextMenu(page.relative_path, count);
        }
      }}
    >
      {isRenaming ? (
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") onRenameCancel();
          }}
          onBlur={commitRename}
          className="w-full rounded border border-interactive-accent bg-bg-primary px-2 py-1 text-xs text-text-normal outline-none"
          style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
        />
      ) : (
        <button
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault();
              onToggleSelect(page.relative_path);
              return;
            }
            if (e.shiftKey) {
              e.preventDefault();
              onRangeSelect(page.relative_path);
              return;
            }
            onPlainSelect(page.relative_path);
          }}
          tabIndex={-1}
          className={`w-full select-none truncate rounded-md px-2 py-1 text-start text-xs ${
            isActive
              ? "bg-nav-active-bg text-nav-active-text"
              : isSelected
                ? "bg-bg-hover text-text-normal"
                : "text-text-normal hover:bg-bg-hover"
          }${isRevealed ? " sidebar-item-revealed" : ""}${isFocused ? " ring-1 ring-interactive-accent" : ""}`}
          style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
          title={page.relative_path}
        >
          {page.file_type === 'pdf' && (
            <span className="nerd-font mr-1 opacity-60" aria-label="PDF file">{''}</span>
          )}
          {page.title}
          {page.has_companion && (
            <span
              className="nerd-font ml-1 opacity-40 hover:opacity-80"
              aria-label="Has companion"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(page.relative_path);
                executeCommand("companion.open");
              }}
            >{'󰌷'}</span>
          )}
        </button>
      )}
    </div>
  );
});

export { SIDEBAR_WIDTH_PX, DEFAULT_SIDEBAR_WIDTH_PX } from "../stores/sidebarLayout";

export function Sidebar({
  onExportNetwork,
  collapsed = false,
  overlay = false,
}: {
  onExportNetwork?: (path: string) => void;
  collapsed?: boolean;
  overlay?: boolean;
} = {}) {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const pages = useWorkspaceStore((s) => s.pages);
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const renamePageAction = useWorkspaceStore((s) => s.renamePage);
  const deletePageAction = useWorkspaceStore((s) => s.deletePage);
  const { tab, setTab } = useSidebarTab();
  // ReferenceLibrary is heavy (bib parsing, file watching, virtualizer), so it
  // stays unmounted until the References tab is first visited; after that it is
  // kept alive and hidden via display:none so its watchers and expanded state
  // survive tab switches.
  const [hasVisitedReferences, setHasVisitedReferences] = useState(() => tab === "references");
  useEffect(() => {
    if (tab === "references") setHasVisitedReferences(true);
  }, [tab]);
  // SearchPanel follows the same lazy-mount + keep-alive pattern so its IPC
  // effects don't run until the Search tab is first visited, and results
  // survive tab switches afterwards.
  const [hasVisitedSearch, setHasVisitedSearch] = useState(() => tab === "search");
  useEffect(() => {
    if (tab === "search") setHasVisitedSearch(true);
  }, [tab]);
  // Bridge for reveal-bib events (editor citekey links, command palette,
  // context menu) that fire before ReferenceLibrary has ever mounted: stash the
  // event, mount ReferenceLibrary, and re-dispatch once its listeners exist
  // (child effects run before this parent's hasVisitedReferences effect).
  const hasVisitedReferencesRef = useRef(hasVisitedReferences);
  hasVisitedReferencesRef.current = hasVisitedReferences;
  const pendingBibRevealRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const offEntry = onRevealBibEntry(({ citekey, bibFile }) => {
      if (hasVisitedReferencesRef.current) return;
      pendingBibRevealRef.current = () => dispatchRevealBibEntry(citekey, bibFile);
      setHasVisitedReferences(true);
    });
    const offForPage = onRevealBibEntryForPage(({ relativePath }) => {
      if (hasVisitedReferencesRef.current) return;
      pendingBibRevealRef.current = () => dispatchRevealBibEntryForPage(relativePath);
      setHasVisitedReferences(true);
    });
    return () => {
      offEntry();
      offForPage();
    };
  }, []);
  useEffect(() => {
    if (!hasVisitedReferences || !pendingBibRevealRef.current) return;
    const redispatch = pendingBibRevealRef.current;
    pendingBibRevealRef.current = null;
    redispatch();
  }, [hasVisitedReferences]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [trashConfirm, setTrashConfirm] = useState<{ paths: string[]; labels: string[] } | null>(null);
  const sidebarWidth = useSidebarLayoutStore((s) => s.sidebarWidth);
  const setSidebarWidth = useSidebarLayoutStore((s) => s.setSidebarWidth);
  const { position } = useSidebarPosition();
  const shellRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  // Re-clamp stored width to parent * maxRatio whenever the sidebar is visible:
  // on mount / un-collapse (immediate) and on window resize (mirror of
  // BottomPanel.clampPanelSize). Never auto-grow; only shrink when the stored
  // width exceeds the new proportional max. While collapsed, do nothing.
  useEffect(() => {
    if (collapsed) return;
    const reClamp = () => {
      const shell = shellRef.current;
      const parent = shell?.parentElement;
      if (!shell || !parent) return;
      const parentW = parent.getBoundingClientRect().width;
      if (parentW <= 0) return;
      const max = parentW * SIDEBAR_MAX_WIDTH_RATIO;
      if (useSidebarLayoutStore.getState().sidebarWidth > max) {
        setSidebarWidth(max);
      }
    };
    reClamp();
    window.addEventListener("resize", reClamp);
    return () => window.removeEventListener("resize", reClamp);
  }, [collapsed, setSidebarWidth]);

  const filtered = useMemo(
    () => deferredSearch ? localeFilter(pages, deferredSearch, (p) => p.title) : pages,
    [pages, deferredSearch],
  );

  const { sortConfig, selectSortKey, comparator } = useSidebarSort(workspacePath ?? "");
  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const { rows, toggleCollapse, revealPath } = useFlatTree(tree, comparator);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  // Mirrored focus handles so runTrash can restore focus after the pages
  // refresh (the hook return values are declared later in the body).
  const focusedIndexRef = useRef(-1);
  const setFocusedIndexRef = useRef<(index: number) => void>(() => {});

  const selectedPaths = useFileTreeSelectionStore((s) => s.selectedPaths);

  const handleToggleSelect = useCallback((path: string) => {
    useFileTreeSelectionStore.getState().toggle(path);
  }, []);

  const handleRangeSelect = useCallback((path: string) => {
    useFileTreeSelectionStore.getState().rangeSelect(path, visiblePagePaths(rows));
  }, [rows]);

  // Open a page from the tree (plain click or keyboard Enter): both reduce the
  // selection to that page so Delete afterwards matches what the user opened.
  const openPageFromTree = useCallback((path: string) => {
    useFileTreeSelectionStore.getState().setOnly(path);
    selectPage(path);
  }, [selectPage]);

  const runTrash = useCallback(async (paths: string[]) => {
    setTrashConfirm(null);
    const rowsBefore = rowsRef.current;
    const focusBefore = focusedIndexRef.current;
    const succeeded: string[] = [];
    for (const path of paths) {
      try {
        await deletePageAction(path);
        succeeded.push(path);
      } catch (e) {
        useStatusMessageStore.getState().show(
          e instanceof Error ? e.message : `Could not trash ${path}`,
          "error",
        );
      }
    }
    // Drop trashed paths from the selection; keep anything that failed.
    const remaining = useWorkspaceStore.getState().pages.map((p) => p.relative_path);
    useFileTreeSelectionStore.getState().pruneTo(remaining);
    // Restore focus to the nearest surviving row by identity. The helper
    // returns a row key from the pre-delete rows; we resolve it against the
    // post-delete rows derived from the same snapshot (rowsBefore minus the
    // succeeded paths) so the result never depends on render timing - the
    // live rowsRef may lag the store during the loop's await boundaries.
    if (succeeded.length > 0 && rowsBefore.length > 0) {
      const focusKey = nextFocusKey(rowsBefore, focusBefore, new Set(succeeded));
      if (focusKey != null) {
        const deleted = new Set(succeeded);
        const rowsAfter = rowsBefore.filter(
          (r) => r.type === "folder" || !deleted.has(r.page.relative_path),
        );
        const idx = rowsAfter.findIndex((r) => r.key === focusKey);
        if (idx >= 0) setFocusedIndexRef.current(idx);
      }
    }
  }, [deletePageAction]);

  const requestTrash = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    if (paths.length === 1) {
      void runTrash(paths);
      return;
    }
    const pages = useWorkspaceStore.getState().pages;
    const labels = paths.map((p) => pages.find((page) => page.relative_path === p)?.title ?? p);
    setTrashConfirm({ paths, labels });
  }, [runTrash]);

  // Selection lifecycle: clear when leaving the Files tab, on workspace change,
  // and prune paths that disappear from pages (trash / rename / external delete).
  // The trash confirm dialog is dismissed on the same transitions so a stale
  // confirm can never survive into another workspace or tab.
  useEffect(() => {
    if (tab !== "files") {
      useFileTreeSelectionStore.getState().clear();
      setTrashConfirm(null);
    }
  }, [tab]);

  const prevWorkspacePathRef = useRef(workspacePath);
  useEffect(() => {
    if (prevWorkspacePathRef.current !== workspacePath) {
      prevWorkspacePathRef.current = workspacePath;
      useFileTreeSelectionStore.getState().clear();
      setTrashConfirm(null);
    }
  }, [workspacePath]);

  useEffect(() => {
    useFileTreeSelectionStore.getState().pruneTo(pages.map((p) => p.relative_path));
  }, [pages]);

  const { focusedIndex, setFocusedIndex, handleKeyDown: handleTreeKeyDown, handleContainerFocus } = useTreeKeyboard({
    rows,
    toggleCollapse,
    selectPage: openPageFromTree,
    scrollToIndex: (index: number) => virtualizer.scrollToIndex(index, { align: "auto" }),
    onTrash: requestTrash,
    onClearSelection: () => useFileTreeSelectionStore.getState().clear(),
    onSelectAllPages: () => {
      useFileTreeSelectionStore.getState().selectAll(visiblePagePaths(rows));
    },
    onToggleSelectPath: handleToggleSelect,
    onRenamePath: (path) => setRenamingPath(path),
    getSelectedPaths: () => useFileTreeSelectionStore.getState().selectedPaths,
  });
  focusedIndexRef.current = focusedIndex;
  setFocusedIndexRef.current = setFocusedIndex;

  const { revealedKey: revealedPath, triggerReveal } = useRevealFlash(virtualizerRef);

  const handleRenameCancel = useCallback(() => setRenamingPath(null), []);

  const handleRenameCommit = useCallback(async (path: string, newName: string) => {
    setRenamingPath(null);
    try {
      await renamePageAction(path, newName);
    } catch (e) {
      useStatusMessageStore.getState().show(
        e instanceof Error ? e.message : "Could not rename page",
        "error",
      );
    }
  }, [renamePageAction]);

  const onExportNetworkRef = useRef(onExportNetwork);
  onExportNetworkRef.current = onExportNetwork;

  useEffect(() => {
    return onSetSidebarTab((tab) => {
      setTab(tab);
    });
  }, [setTab]);

  // Allow programmatic switching to the search tab from anywhere (e.g. Shift+Cmd+F).
  // SearchPanel focuses its own input: on first visit via its mount effect, and on
  // later dispatches via its own lit:focus-search-panel listener.
  useEffect(() => {
    const handler = () => {
      ensureSidebarVisible();
      setTab("search");
    };
    window.addEventListener("lit:focus-search-panel", handler);
    return () => window.removeEventListener("lit:focus-search-panel", handler);
  }, [setTab]);

  // Bridge: CommandPalette "Cmd+Enter" transfers query to search panel
  useEffect(() => {
    const handler = (e: Event) => {
      const { query } = (e as CustomEvent<{ query: string }>).detail;
      ensureSidebarVisible();
      setTab("search");
      useSearchPanelStore.getState().setQuery(query);
      // Focus the search input after React renders the tab switch
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent("lit:focus-search-panel"));
      });
    };
    window.addEventListener("lit:open-search-panel-with-query", handler);
    return () => window.removeEventListener("lit:open-search-panel-with-query", handler);
  }, [setTab]);

  const pendingRevealRef = useRef<string | null>(null);

  useEffect(() => {
    return onRevealInFileTree(({ relativePath }) => {
      ensureSidebarVisible();
      setTab("files");

      // revealPath expands ancestor folders synchronously and returns the
      // target's row index. Returns -1 only when the file is absent from
      // the current tree (filtered out by search).
      const idx = revealPath(relativePath);

      if (idx >= 0) {
        triggerReveal(relativePath, idx);
        setFocusedIndex(idx);
      } else {
        // Target is filtered out — clear search and defer.
        setSearch("");
        pendingRevealRef.current = relativePath;
      }
    });
  }, [setTab, revealPath, triggerReveal, setFocusedIndex]);

  // Deferred reveal: when rows update after clearing search, complete the
  // pending reveal. `rows` gets a new reference whenever `root`/`expanded`/
  // `pageComparator` change, which happens when `deferredSearch` catches up
  // after setSearch("").
  useEffect(() => {
    const target = pendingRevealRef.current;
    if (!target) return;
    pendingRevealRef.current = null;

    const idx = revealPath(target);
    triggerReveal(target, idx);
    if (idx >= 0) setFocusedIndex(idx);
  }, [rows, revealPath, triggerReveal, setFocusedIndex]);

  const autoRevealInSidebar = usePreferencesStore((s) => s.autoRevealInSidebar);
  // Read via ref so tab switches alone don't re-trigger the reveal effect.
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    if (!autoRevealInSidebar || !currentPagePath) return;

    // Auto-reveal belongs to the Files tab only. Never steal focus from
    // References / Outline / Search as a side effect of navigation.
    if (tabRef.current !== "files") return;

    // Reveal in place. Do not dispatch lit:reveal-in-file-tree (that path
    // clears filters and is reserved for explicit manual reveal). If the
    // page is filtered out by the current Files search, silently skip.
    ensureSidebarVisible();

    const idx = revealPath(currentPagePath);
    if (idx >= 0) {
      triggerReveal(currentPagePath, idx);
      setFocusedIndex(idx);
    }
  }, [autoRevealInSidebar, currentPagePath, revealPath, triggerReveal, setFocusedIndex]);

  const dispatchRevealLibrary = useCallback((relativePath: string) => {
    dispatchRevealBibEntryForPage(relativePath);
  }, []);

  useSidebarContextMenu({
    onRename: (relativePath) => setRenamingPath(relativePath),
    onExternalEditor: (relativePath) => openInExternalEditor(relativePath, 1, 1),
    onExportNetwork: (relativePath) => onExportNetworkRef.current?.(relativePath),
    onTrash: (relativePath) => {
      const selected = useFileTreeSelectionStore.getState().selectedPaths;
      const paths =
        selected.size > 1 && selected.has(relativePath)
          ? visiblePagePaths(rows).filter((p) => selected.has(p))
          : [relativePath];
      requestTrash(paths);
    },
    onShowInFinder: (relativePath) => {
      if (workspacePath) {
        join(workspacePath, relativePath).then((abs) => revealItemInDir(abs));
      }
    },
    onRevealLibrary: dispatchRevealLibrary,
  });

  const shellStyle: React.CSSProperties = overlay
    ? {
        position: "absolute",
        zIndex: 46,
        top: 0,
        [position === "right" ? "right" : "left"]: 0,
        height: "100%",
        width: sidebarWidth,
        overflow: "hidden",
      }
    : {
        width: collapsed ? 0 : sidebarWidth,
        transition: "width 150ms ease-out",
        overflow: "hidden",
        flexShrink: 0,
      };

  return (
    <div
      ref={shellRef}
      data-testid="sidebar-shell"
      className="relative h-full"
      style={shellStyle}
    >
      <ResizeHandle
        direction={position === "right" ? "right" : "left"}
        currentSize={sidebarWidth}
        enabled={!collapsed}
        minSize={MIN_SIDEBAR_WIDTH_PX}
        panelRef={shellRef}
        contentRef={asideRef}
        onResizeEnd={setSidebarWidth}
      />
    <aside ref={asideRef} className="flex h-full shrink-0 flex-col bg-bg-secondary" style={{ width: sidebarWidth }}>
      <div className="flex items-center border-b border-border-subtle">
        <button
          onClick={() => setTab("files")}
          title="Files"
          aria-label="Files"
          className={`flex-1 px-3 py-2 text-xs font-medium ${
            tab === "files"
              ? "text-text-normal opacity-100"
              : "text-text-faint opacity-60 hover:text-text-muted hover:opacity-80"
          }`}
        >
          <span className="nerd-font text-base" aria-hidden="true">{'󰈙'}</span>
        </button>
        <button
          onClick={() => setTab("outline")}
          title="Outline"
          aria-label="Outline"
          className={`flex-1 px-3 py-2 text-xs font-medium ${
            tab === "outline"
              ? "text-text-normal opacity-100"
              : "text-text-faint opacity-60 hover:text-text-muted hover:opacity-80"
          }`}
        >
          <span className="nerd-font text-base" aria-hidden="true">{'󰠶'}</span>
        </button>
        <button
          onClick={() => setTab("search")}
          title="Search"
          aria-label="Search"
          className={`flex-1 px-3 py-2 text-xs font-medium ${
            tab === "search"
              ? "text-text-normal opacity-100"
              : "text-text-faint opacity-60 hover:text-text-muted hover:opacity-80"
          }`}
        >
          <span className="nerd-font text-base" aria-hidden="true">{'󰍉'}</span>
        </button>
        <button
          onClick={() => setTab("references")}
          title="References"
          aria-label="References"
          className={`flex-1 px-3 py-2 text-xs font-medium ${
            tab === "references"
              ? "text-text-normal opacity-100"
              : "text-text-faint opacity-60 hover:text-text-muted hover:opacity-80"
          }`}
        >
          <span className="nerd-font text-base" aria-hidden="true">{'󱉟'}</span>
        </button>
      </div>
      {tab === "files" ? (
        <>
          <div className="flex items-center gap-1 p-2">
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-0 flex-1 rounded-md border-none bg-bg-hover px-2 py-1 text-xs text-text-normal"
              aria-label="Search pages"
            />
            <SortDropdown sortConfig={sortConfig} onSelectKey={selectSortKey} />
          </div>
          <div
            ref={scrollRef}
            data-testid="sidebar-file-list"
            data-virtual-scroll
            role="tree"
            aria-label="File tree"
            aria-activedescendant={focusedIndex >= 0 && rows[focusedIndex] ? "tree-item-" + rows[focusedIndex].key : undefined}
            tabIndex={0}
            onKeyDown={(e) => {
              // While the trash confirm is open the tree keyboard is inert:
              // Escape must cancel the dialog (document listener) instead of
              // clearing selection, and Delete must not re-enter requestTrash.
              if (trashConfirm) return;
              handleTreeKeyDown(e);
            }}
            onFocus={handleContainerFocus}
            className="flex-1 overflow-y-auto overscroll-contain px-1 outline-none"
          >
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index]!;
                return (
                  <div
                    key={row.key}
                    data-index={virtualRow.index}
                    onClick={(e) => {
                      setFocusedIndex(virtualRow.index);
                      // Don't steal focus from the inline rename <input>.
                      if (!(e.target instanceof HTMLInputElement)) {
                        scrollRef.current?.focus({ preventScroll: true });
                      }
                    }}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {row.type === "folder" ? (
                      <button
                        id={"tree-item-" + row.key}
                        onClick={() => toggleCollapse(row.folderPath)}
                        role="treeitem"
                        aria-expanded={!row.isCollapsed}
                        aria-level={row.depth + 1}
                        tabIndex={-1}
                        className={`flex w-full min-w-0 items-center gap-1 rounded-md px-2 py-1 text-start text-xs text-text-muted hover:bg-bg-hover${
                          focusedIndex === virtualRow.index ? " ring-1 ring-interactive-accent" : ""
                        }`}
                        style={{ paddingInlineStart: `${row.depth * 12 + 8}px` }}
                      >
                        <span className="text-xs">{row.isCollapsed ? "▸" : "▾"}</span>
                        <span className="truncate font-medium">{row.folderName}</span>
                      </button>
                    ) : (
                      <PageItem
                        id={"tree-item-" + row.key}
                        page={row.page}
                        isActive={currentPagePath === row.page.relative_path}
                        isSelected={selectedPaths.has(row.page.relative_path)}
                        isRenaming={renamingPath === row.page.relative_path}
                        isRevealed={revealedPath === row.page.relative_path}
                        isFocused={focusedIndex === virtualRow.index}
                        onSelect={selectPage}
                        onToggleSelect={handleToggleSelect}
                        onRangeSelect={handleRangeSelect}
                        onPlainSelect={openPageFromTree}
                        onRenameCommit={handleRenameCommit}
                        onRenameCancel={handleRenameCancel}
                        depth={row.depth}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : tab === "outline" ? (
        <Outline />
      ) : null}
      {hasVisitedReferences && (
        <div
          className="flex flex-1 flex-col overflow-hidden"
          style={{ display: tab === "references" ? "flex" : "none" }}
        >
          <ReferenceLibrary />
        </div>
      )}
      {hasVisitedSearch && (
        <div
          className="flex flex-1 flex-col overflow-hidden"
          style={{ display: tab === "search" ? "flex" : "none" }}
        >
          <SearchPanel isActive={tab === "search"} />
        </div>
      )}
      <TrashPagesDialog
        paths={trashConfirm?.paths ?? []}
        labels={trashConfirm?.labels ?? []}
        onCancel={() => setTrashConfirm(null)}
        onConfirm={() => {
          if (trashConfirm) void runTrash(trashConfirm.paths);
        }}
      />
    </aside>
    </div>
  );
}
