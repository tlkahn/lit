import { useState, useRef, useEffect, useMemo, useDeferredValue, useCallback, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useWorkspaceStore } from "../stores/workspace";
import { openInExternalEditor } from "../lib/ipc";
import { showSidebarContextMenu, useSidebarContextMenu } from "../lib/contextMenuIpc";
import { localeFilter } from "../lib/localeSearch";
import { useSidebarTab, type SidebarTab } from "../hooks/useSidebarTab";
import { useFlatTree, type FolderNode } from "../hooks/useFlatTree";
import { useSidebarSort } from "../hooks/useSidebarSort";
import { Outline } from "./Outline";
import { TrashPanel } from "./TrashPanel";
import { ReferenceLibrary } from "./ReferenceLibrary";
import { SortDropdown } from "./SortDropdown";
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
  isRenaming,
  onSelect,
  onRenameCommit,
  onRenameCancel,
  depth,
}: {
  page: PageMeta;
  isActive: boolean;
  isRenaming: boolean;
  onSelect: (path: string) => void;
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
      className="group relative"
      onContextMenu={(e) => {
        e.preventDefault();
        if (!isRenaming) {
          showSidebarContextMenu(page.relative_path);
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
          onClick={() => onSelect(page.relative_path)}
          className={`w-full select-none truncate rounded-md px-2 py-1 text-start text-xs ${
            isActive
              ? "bg-nav-active-bg text-nav-active-text"
              : "text-text-normal hover:bg-bg-hover"
          }`}
          style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
          title={page.relative_path}
        >
          {page.file_type === 'pdf' && (
            <span className="nerd-font mr-1 opacity-60" aria-label="PDF file">{''}</span>
          )}
          {page.title}
        </button>
      )}
    </div>
  );
});

export const SIDEBAR_WIDTH_PX = 240;

export function Sidebar({ onExportNetwork }: { onExportNetwork?: (path: string) => void } = {}) {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const pages = useWorkspaceStore((s) => s.pages);
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const renamePageAction = useWorkspaceStore((s) => s.renamePage);
  const deletePageAction = useWorkspaceStore((s) => s.deletePage);
  const { tab, setTab } = useSidebarTab();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const filtered = useMemo(
    () => deferredSearch ? localeFilter(pages, deferredSearch, (p) => p.title) : pages,
    [pages, deferredSearch],
  );

  const { sortConfig, selectSortKey, comparator } = useSidebarSort(workspacePath ?? "");
  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const { rows, toggleCollapse } = useFlatTree(tree, comparator);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  const handleRenameCancel = useCallback(() => setRenamingPath(null), []);

  const handleRenameCommit = useCallback((path: string, newName: string) => {
    setRenamingPath(null);
    renamePageAction(path, newName);
  }, [renamePageAction]);

  const onExportNetworkRef = useRef(onExportNetwork);
  onExportNetworkRef.current = onExportNetwork;

  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent<SidebarTab>).detail;
      setTab(tab);
    };
    window.addEventListener("lit:set-sidebar-tab", handler);
    return () => window.removeEventListener("lit:set-sidebar-tab", handler);
  }, [setTab]);

  useSidebarContextMenu({
    onRename: (relativePath) => setRenamingPath(relativePath),
    onExternalEditor: (relativePath) => openInExternalEditor(relativePath, 1, 1),
    onExportNetwork: (relativePath) => onExportNetworkRef.current?.(relativePath),
    onTrash: (relativePath) => deletePageAction(relativePath),
  });

  return (
    <aside className="flex h-full shrink-0 flex-col bg-bg-secondary" style={{ width: SIDEBAR_WIDTH_PX }}>
      <div
        className="flex items-center border-b border-border-subtle"
        role="tablist"
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const tabs: SidebarTab[] = ["files", "outline", "trash", "references"];
          const step = e.key === "ArrowRight" ? 1 : -1;
          const len = tabs.length;
          const idx = (tabs.indexOf(tab) + step + len) % len;
          const nextTab = tabs[idx]!;
          setTab(nextTab);
          const buttons = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("button");
          buttons[idx]?.focus();
        }}
      >
        <button
          onClick={() => setTab("files")}
          title="Files"
          role="tab"
          aria-selected={tab === "files"}
          aria-label="Files"
          className={`flex-1 px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive-accent ${
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
          role="tab"
          aria-selected={tab === "outline"}
          aria-label="Outline"
          className={`flex-1 px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive-accent ${
            tab === "outline"
              ? "text-text-normal opacity-100"
              : "text-text-faint opacity-60 hover:text-text-muted hover:opacity-80"
          }`}
        >
          <span className="nerd-font text-base" aria-hidden="true">{'󰲞'}</span>
        </button>
        <button
          onClick={() => setTab("trash")}
          title="Trash"
          role="tab"
          aria-selected={tab === "trash"}
          aria-label="Trash"
          className={`flex-1 px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive-accent ${
            tab === "trash"
              ? "text-text-normal opacity-100"
              : "text-text-faint opacity-60 hover:text-text-muted hover:opacity-80"
          }`}
        >
          <span className="nerd-font text-base" aria-hidden="true">{'󰆴'}</span>
        </button>
        <button
          onClick={() => setTab("references")}
          title="References"
          role="tab"
          aria-selected={tab === "references"}
          aria-label="References"
          className={`flex-1 px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive-accent ${
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
            className="flex-1 overflow-y-auto overscroll-contain px-1"
          >
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index]!;
                return (
                  <div
                    key={row.key}
                    data-index={virtualRow.index}
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
                        onClick={() => toggleCollapse(row.folderPath)}
                        className="flex w-full min-w-0 items-center gap-1 rounded-md px-2 py-1 text-start text-xs text-text-muted hover:bg-bg-hover"
                        style={{ paddingInlineStart: `${row.depth * 12 + 8}px` }}
                      >
                        <span className="text-xs">{row.isCollapsed ? "▸" : "▾"}</span>
                        <span className="truncate font-medium">{row.folderName}</span>
                      </button>
                    ) : (
                      <PageItem
                        page={row.page}
                        isActive={currentPagePath === row.page.relative_path}
                        isRenaming={renamingPath === row.page.relative_path}
                        onSelect={selectPage}
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
      ) : tab === "trash" ? (
        <TrashPanel />
      ) : null}
      <div
        className="flex flex-1 flex-col overflow-hidden"
        style={{ display: tab === "references" ? "flex" : "none" }}
      >
        <ReferenceLibrary />
      </div>
    </aside>
  );
}
