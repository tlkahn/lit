import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "../stores/workspace";
import { openWorkspaceWindow } from "../lib/ipc";
import { getNextUntitledName } from "../lib/naming";
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
  onSelect,
  onDelete,
  onRename,
  depth,
}: {
  node: FolderNode;
  currentPagePath: string | null;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  onRename: (path: string) => void;
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
              onSelect={onSelect}
              onDelete={onDelete}
              onRename={onRename}
              depth={depth + (node.name ? 1 : 0)}
            />
          ))}
          {node.pages.map((page) => (
            <PageItem
              key={page.relative_path}
              page={page}
              isActive={currentPagePath === page.relative_path}
              onSelect={onSelect}
              onDelete={onDelete}
              onRename={onRename}
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
  onSelect,
  onDelete,
  onRename,
  depth,
}: {
  page: PageMeta;
  isActive: boolean;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  onRename: (path: string) => void;
  depth: number;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div
      className="group relative"
      onContextMenu={(e) => {
        e.preventDefault();
        setShowMenu(!showMenu);
      }}
    >
      <button
        onClick={() => onSelect(page.relative_path)}
        className={`w-full truncate rounded px-2 py-1 text-left text-sm ${
          isActive
            ? "bg-nav-active-bg text-nav-active-text"
            : "text-text-normal hover:bg-bg-hover"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={page.relative_path}
      >
        {page.title}
      </button>
      {showMenu && (
        <div className="absolute right-2 top-0 z-10 rounded border border-border bg-bg-primary shadow-lg">
          <button
            onClick={() => {
              setShowMenu(false);
              onRename(page.relative_path);
            }}
            className="block w-full px-4 py-1 text-left text-sm text-text-normal hover:bg-bg-hover"
          >
            Rename
          </button>
          <button
            onClick={() => {
              setShowMenu(false);
              onDelete(page.relative_path);
            }}
            className="block w-full px-4 py-1 text-left text-sm text-text-error hover:bg-bg-hover"
          >
            Delete
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
  const [search, setSearch] = useState("");

  const filtered = search
    ? pages.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()))
    : pages;

  const tree = buildTree(filtered);

  const handleNewPage = () => {
    const name = getNextUntitledName(pages);
    createPageAction(name);
  };

  const handleRename = (path: string) => {
    const newName = window.prompt("New name:");
    if (newName?.trim()) {
      renamePageAction(path, newName.trim());
    }
  };

  const handleDelete = (path: string) => {
    if (window.confirm(`Delete "${path}"?`)) {
      deletePageAction(path);
    }
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-secondary">
      <div className="flex items-center justify-between p-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-faint">
          Pages
        </h2>
        <button
          onClick={handleNewPage}
          className="rounded px-2 py-0.5 text-sm text-text-faint hover:bg-bg-hover"
          aria-label="New page"
        >
          +
        </button>
      </div>
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
          onSelect={selectPage}
          onDelete={handleDelete}
          onRename={handleRename}
          depth={0}
        />
      </div>
      <div className="p-2">
        <button
          onClick={async () => {
            const selected = await open({ directory: true });
            if (selected) {
              await openWorkspaceWindow(selected);
            }
          }}
          className="w-full rounded px-2 py-1.5 text-left text-sm text-text-faint hover:bg-bg-hover"
        >
          Open Another Workspace
        </button>
      </div>
    </aside>
  );
}
