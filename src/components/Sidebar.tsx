import { useState, useRef, useEffect } from "react";
import { useWorkspaceStore } from "../stores/workspace";
import { getNextUntitledName } from "../lib/naming";
import { openInExternalEditor } from "../lib/ipc";
import { useSidebarTab } from "../hooks/useSidebarTab";
import { Outline } from "./Outline";
import type { PageMeta } from "../lib/ipc";

interface FolderNode {
  name: string;
  pages: PageMeta[];
  children: Map<string, FolderNode>;
}

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

function FolderView({
  node,
  currentPagePath,
  menuPath,
  renamingPath,
  onSelect,
  onDelete,
  onMenuOpen,
  onMenuClose,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  depth,
}: {
  node: FolderNode;
  currentPagePath: string | null;
  menuPath: string | null;
  renamingPath: string | null;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  onMenuOpen: (path: string) => void;
  onMenuClose: () => void;
  onRenameStart: (path: string) => void;
  onRenameCommit: (path: string, newName: string) => void;
  onRenameCancel: () => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const sortedDirs = [...node.children.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div>
      {node.name && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm text-text-muted hover:bg-bg-hover"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className="text-xs">{collapsed ? "▸" : "▾"}</span>
          <span className="font-medium">{node.name}</span>
        </button>
      )}
      {!collapsed && (
        <>
          {sortedDirs.map(([dirName, child]) => (
            <FolderView
              key={dirName}
              node={child}
              currentPagePath={currentPagePath}
              menuPath={menuPath}
              renamingPath={renamingPath}
              onSelect={onSelect}
              onDelete={onDelete}
              onMenuOpen={onMenuOpen}
              onMenuClose={onMenuClose}
              onRenameStart={onRenameStart}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
              depth={depth + (node.name ? 1 : 0)}
            />
          ))}
          {node.pages.map((page) => (
            <PageItem
              key={page.relative_path}
              page={page}
              isActive={currentPagePath === page.relative_path}
              showMenu={menuPath === page.relative_path}
              isRenaming={renamingPath === page.relative_path}
              onSelect={onSelect}
              onDelete={onDelete}
              onMenuOpen={onMenuOpen}
              onMenuClose={onMenuClose}
              onRenameStart={onRenameStart}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
              depth={depth + (node.name ? 1 : 0)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function PageItem({
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
        if (!isRenaming) onMenuOpen(page.relative_path);
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
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        />
      ) : (
        <button
          onClick={() => onSelect(page.relative_path)}
          className={`w-full select-none truncate rounded px-2 py-1 text-left text-sm ${
            isActive
              ? "bg-nav-active-bg text-nav-active-text"
              : showMenu
                ? "bg-bg-hover text-text-normal"
                : "text-text-normal hover:bg-bg-hover"
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          title={page.relative_path}
        >
          {page.title}
        </button>
      )}
      {showMenu && (
        <div ref={menuRef} className="absolute right-2 top-0 z-10 select-none rounded border border-border bg-bg-primary shadow-lg">
          <button
            onClick={() => {
              onMenuClose();
              onRenameStart(page.relative_path);
            }}
            className="block w-full px-4 py-1 text-left text-sm text-text-normal hover:bg-bg-hover"
          >
            Rename
          </button>
          <button
            onClick={() => {
              onMenuClose();
              onDelete(page.relative_path);
            }}
            className="block w-full px-4 py-1 text-left text-sm text-text-error hover:bg-bg-hover"
          >
            Delete
          </button>
          <button
            onClick={() => {
              onMenuClose();
              openInExternalEditor(page.relative_path, 1, 1);
            }}
            className="block w-full px-4 py-1 text-left text-sm text-text-normal hover:bg-bg-hover"
          >
            Open in External Editor
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const pages = useWorkspaceStore((s) => s.pages);
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const createPageAction = useWorkspaceStore((s) => s.createPage);
  const renamePageAction = useWorkspaceStore((s) => s.renamePage);
  const deletePageAction = useWorkspaceStore((s) => s.deletePage);
  const { tab, setTab } = useSidebarTab();
  const [search, setSearch] = useState("");
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const filtered = search
    ? pages.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()))
    : pages;

  const tree = buildTree(filtered);

  const handleNewPage = () => {
    const name = getNextUntitledName(pages);
    createPageAction(name);
  };

  const handleRenameCommit = (path: string, newName: string) => {
    setRenamingPath(null);
    renamePageAction(path, newName);
  };

  const handleDelete = (path: string) => {
    if (window.confirm(`Delete "${path}"?`)) {
      deletePageAction(path);
    }
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-secondary">
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
          <div className="flex-1 overflow-y-auto px-1">
            <FolderView
              node={tree}
              currentPagePath={currentPagePath}
              menuPath={menuPath}
              renamingPath={renamingPath}
              onSelect={selectPage}
              onDelete={handleDelete}
              onMenuOpen={setMenuPath}
              onMenuClose={() => setMenuPath(null)}
              onRenameStart={setRenamingPath}
              onRenameCommit={handleRenameCommit}
              onRenameCancel={() => setRenamingPath(null)}
              depth={0}
            />
          </div>
        </>
      ) : (
        <Outline />
      )}
      <div className="border-t border-border p-2">
        <button
          onClick={handleNewPage}
          className="w-full rounded px-2 py-1 text-sm text-text-faint hover:bg-bg-hover"
          aria-label="New page"
        >
          + New Page
        </button>
      </div>
    </aside>
  );
}
