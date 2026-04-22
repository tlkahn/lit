import { create } from "zustand";
import * as ipc from "../lib/ipc";
import type { PageMeta } from "../lib/ipc";
import type { Heading } from "../lib/headings";

const RECENT_KEY = "lit-recent-workspaces";
const LEGACY_KEY = "lit-workspace-path";
const MAX_RECENT = 10;

export interface WorkspaceStore {
  workspacePath: string | null;
  pages: PageMeta[];
  currentPagePath: string | null;
  pendingTitleFocus: boolean;
  currentPageHeadings: Heading[];
  isDirty: boolean;
  reloadTrigger: number;
  loading: boolean;
  error: string | null;

  openWorkspace: (path: string) => Promise<void>;
  refreshPages: () => Promise<void>;
  selectPage: (relativePath: string | null) => void;
  createPage: (name: string, parentDir?: string) => Promise<void>;
  renamePage: (oldPath: string, newName: string) => Promise<void>;
  deletePage: (relativePath: string) => Promise<void>;
  clearPendingTitleFocus: () => void;
  setCurrentPageHeadings: (headings: Heading[]) => void;
  setDirty: (dirty: boolean) => void;
  triggerReload: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspacePath: null,
  pages: [],
  currentPagePath: null,
  pendingTitleFocus: false,
  currentPageHeadings: [],
  isDirty: false,
  reloadTrigger: 0,
  loading: false,
  error: null,

  openWorkspace: async (path: string) => {
    set({ loading: true, error: null });
    try {
      const pages = await ipc.openWorkspace(path);
      set({ workspacePath: path, pages, loading: false });
      addRecentWorkspace(path);
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  refreshPages: async () => {
    const { workspacePath } = get();
    if (!workspacePath) return;
    try {
      const pages = await ipc.listPages();
      set({ pages });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectPage: (relativePath: string | null) => {
    if (relativePath === null) {
      console.warn("[WorkspaceStore] selectPage(null) called — stack:", new Error().stack);
    }
    set({ currentPagePath: relativePath, currentPageHeadings: [], isDirty: false, reloadTrigger: 0 });
  },

  createPage: async (name: string, parentDir?: string) => {
    try {
      const meta = await ipc.createPage(name, parentDir);
      set((state) => ({
        pages: [...state.pages, meta],
        currentPagePath: meta.relative_path,
        pendingTitleFocus: true,
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  renamePage: async (oldPath: string, newName: string) => {
    try {
      const newPath = await ipc.renamePage(oldPath, newName);
      set((state) => ({
        pages: state.pages.map((p) =>
          p.relative_path === oldPath
            ? { ...p, title: newName, relative_path: newPath }
            : p,
        ),
        currentPagePath:
          state.currentPagePath === oldPath ? newPath : state.currentPagePath,
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearPendingTitleFocus: () => set({ pendingTitleFocus: false }),

  setCurrentPageHeadings: (headings: Heading[]) => set({ currentPageHeadings: headings }),

  setDirty: (dirty: boolean) => set({ isDirty: dirty }),

  triggerReload: () => set((state) => ({ reloadTrigger: state.reloadTrigger + 1 })),

  deletePage: async (relativePath: string) => {
    try {
      await ipc.deletePage(relativePath);
      set((state) => ({
        pages: state.pages.filter((p) => p.relative_path !== relativePath),
        currentPagePath:
          state.currentPagePath === relativePath ? null : state.currentPagePath,
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));

export function getRecentWorkspaces(): string[] {
  const raw = localStorage.getItem(RECENT_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to migration
    }
  }
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    const list = [legacy];
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    localStorage.removeItem(LEGACY_KEY);
    return list;
  }
  return [];
}

export function addRecentWorkspace(path: string): void {
  const list = getRecentWorkspaces().filter((p) => p !== path);
  list.unshift(path);
  if (list.length > MAX_RECENT) list.length = MAX_RECENT;
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}
