import { useState, useRef, useEffect, useMemo, useDeferredValue, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useWorkspaceStore } from "../stores/workspace";
import { getNextUntitledName } from "../lib/naming";
import { openInExternalEditor } from "../lib/ipc";
import { localeFilter } from "../lib/localeSearch";
import { useSidebarTab } from "../hooks/useSidebarTab";
import { useFlatTree, type FolderNode } from "../hooks/useFlatTree";
import { Outline } from "./Outline";
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
  page,
  isActive,
  showMenu,
  isRenaming,
  onSelect,
  onDelete,
  onMenuOpen,
  onMenuClose,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  depth,
}: {
  page: PageMeta;
  isActive: boolean;
  showMenu: boolean;
  isRenaming: boolean;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  onMenuOpen: (path: string) => void;
  onMenuClose: () => void;
  onRenameStart: (path: string) => void;
  onRenameCommit: (path: string, newName: string) => void;
  onRenameCancel: () => void;
  depth: number;
}) {
  const [renameValue, setRenameValue] = useState(page.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onMenuClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onMenuClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showMenu, onMenuClose]);

  useEffect(() => {
    if (!showMenu || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = menuPosRef.current.x;
    let top = menuPosRef.current.y;
    if (left + rect.width > vw) left = vw - rect.width;
    if (top + rect.height > vh) top = vh - rect.height;
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    menu.style.pointerEvents = "none";
    const onMove = () => { menu.style.pointerEvents = ""; };
    document.addEventListener("pointermove", onMove, { once: true });
    return () => { document.removeEventListener("pointermove", onMove); };
  }, [showMenu]);

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
      className="group relative"
      onContextMenu={(e) => {
        e.preventDefault();
        if (!isRenaming) {
          menuPosRef.current = { x: e.clientX, y: e.clientY };
          onMenuOpen(page.relative_path);
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
          className="w-full rounded border border-interactive-accent bg-bg-primary px-2 py-1 text-sm text-text-normal outline-none"
          style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
        />
      ) : (
        <button
          onClick={() => onSelect(page.relative_path)}
          className={`w-full select-none truncate rounded px-2 py-1 text-start text-sm ${
            isActive
              ? "bg-nav-active-bg text-nav-active-text"
              : showMenu
                ? "bg-bg-hover text-text-normal"
                : "text-text-normal hover:bg-bg-hover"
          }`}
          style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
          title={page.relative_path}
        >
          {page.title}
        </button>
      )}
      {showMenu && createPortal(
        <div
          ref={menuRef}
          data-testid="context-menu"
          className="z-50 min-w-[160px] select-none rounded-lg border border-border/40 bg-bg-primary/80 p-1 shadow-xl shadow-black/20 backdrop-blur-xl backdrop-saturate-150 dark:border-border/10 dark:bg-bg-primary/70"
          style={{ position: "fixed", left: `${menuPosRef.current.x}px`, top: `${menuPosRef.current.y}px` }}
        >
          <button
            onClick={() => {
              onMenuClose();
              onRenameStart(page.relative_path);
            }}
            className="block w-full rounded-md px-3 py-1 text-start text-[13px] text-text-normal hover:bg-interactive-accent hover:text-text-on-accent"
          >
            Rename
          </button>
          <button
            onClick={() => {
              onMenuClose();
              openInExternalEditor(page.relative_path, 1, 1);
            }}
            className="block w-full rounded-md px-3 py-1 text-start text-[13px] text-text-normal hover:bg-interactive-accent hover:text-text-on-accent"
          >
            Open in External Editor
          </button>
          <div className="mx-2 my-1 border-t border-border/40 dark:border-border/10" />
          <button
            onClick={() => {
              onMenuClose();
              onDelete(page.relative_path);
            }}
            className="block w-full rounded-md px-3 py-1 text-start text-[13px] text-text-error hover:bg-destructive hover:text-text-on-accent"
          >
            Delete
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
});

export function Sidebar() {
  const pages = useWorkspaceStore((s) => s.pages);
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const createPageAction = useWorkspaceStore((s) => s.createPage);
  const renamePageAction = useWorkspaceStore((s) => s.renamePage);
  const deletePageAction = useWorkspaceStore((s) => s.deletePage);
  const { tab, setTab } = useSidebarTab();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const filtered = useMemo(
    () => deferredSearch ? localeFilter(pages, deferredSearch, (p) => p.title) : pages,
    [pages, deferredSearch],
  );

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const { rows, toggleCollapse } = useFlatTree(tree);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });

  const handleNewPage = () => {
    const name = getNextUntitledName(pages);
    createPageAction(name);
  };

  const handleMenuClose = useCallback(() => setMenuPath(null), []);
  const handleRenameCancel = useCallback(() => setRenamingPath(null), []);

  const handleRenameCommit = useCallback((path: string, newName: string) => {
    setRenamingPath(null);
    renamePageAction(path, newName);
  }, [renamePageAction]);

  const handleDelete = useCallback((path: string) => {
    if (window.confirm(`Delete "${path}"?`)) {
      deletePageAction(path);
    }
  }, [deletePageAction]);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-e border-border bg-bg-secondary">
      <div className="flex items-center border-b border-border">
        <button
          onClick={() => setTab("files")}
          className={`flex-1 px-3 py-2 text-sm font-medium ${
            tab === "files"
              ? "border-b-2 border-interactive-accent text-text-normal"
              : "text-text-faint hover:text-text-muted"
          }`}
        >
          Files
        </button>
        <button
          onClick={() => setTab("outline")}
          className={`flex-1 px-3 py-2 text-sm font-medium ${
            tab === "outline"
              ? "border-b-2 border-interactive-accent text-text-normal"
              : "text-text-faint hover:text-text-muted"
          }`}
        >
          Outline
        </button>
      </div>
      {tab === "files" ? (
        <>
          <div className="p-2">
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded border border-border bg-bg-primary px-2 py-1 text-sm text-text-normal"
              aria-label="Search pages"
            />
          </div>
          <div
            ref={scrollRef}
            data-testid="sidebar-file-list"
            data-virtual-scroll
            className="flex-1 overflow-y-auto overscroll-contain px-1"
          >
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index]!;
                const hasMenu = row.type === "page" && menuPath === row.page.relative_path;
                return (
                  <div
                    key={row.key}
                    data-index={virtualRow.index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      zIndex: hasMenu ? 50 : undefined,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {row.type === "folder" ? (
                      <button
                        onClick={() => toggleCollapse(row.folderPath)}
                        className="flex w-full min-w-0 items-center gap-1 rounded px-2 py-1 text-start text-sm text-text-muted hover:bg-bg-hover"
                        style={{ paddingInlineStart: `${row.depth * 12 + 8}px` }}
                      >
                        <span className="text-xs">{row.isCollapsed ? "▸" : "▾"}</span>
                        <span className="truncate font-medium">{row.folderName}</span>
                      </button>
                    ) : (
                      <PageItem
                        page={row.page}
                        isActive={currentPagePath === row.page.relative_path}
                        showMenu={menuPath === row.page.relative_path}
                        isRenaming={renamingPath === row.page.relative_path}
                        onSelect={selectPage}
                        onDelete={handleDelete}
                        onMenuOpen={setMenuPath}
                        onMenuClose={handleMenuClose}
                        onRenameStart={setRenamingPath}
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
      ) : (
        <Outline />
      )}
      <div className="flex h-8 shrink-0 items-center bg-bg-primary-alt px-4 shadow-[0_-2px_4px_rgba(0,0,0,0.08)]">
        <button
          onClick={handleNewPage}
          className="flex h-full items-center px-3 text-sm text-text-muted hover:text-text-normal"
          aria-label="New page"
        >
          + New Page
        </button>
      </div>
    </aside>
  );
}
