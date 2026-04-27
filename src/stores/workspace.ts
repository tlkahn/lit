import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import * as ipc from "../lib/ipc";
import type { PageMeta, IndexProgress } from "../lib/ipc";
import type { Heading } from "../lib/headings";

const RECENT_KEY = "lit-recent-workspaces";
const LEGACY_KEY = "lit-workspace-path";
const MAX_RECENT = 10;

export interface ViewState {
  scrollTop: number;
  cursor: number;
}

export interface WorkspaceStore {
  workspacePath: string | null;
  pages: PageMeta[];
  currentPagePath: string | null;
  pendingTitleFocus: boolean;
  pendingCursorLine: number | null;
  pendingCursorCol: number | null;
  pendingSection: string | null;
  currentPageHeadings: Heading[];
  isDirty: boolean;
  reloadTrigger: number;
  viewStates: Record<string, ViewState>;
  graphReady: boolean;
  indexProgress: IndexProgress | null;
  loading: boolean;
  error: string | null;

  openWorkspace: (path: string) => Promise<void>;
  refreshPages: () => Promise<void>;
  selectPage: (relativePath: string | null) => void;
  selectPageAtLine: (relativePath: string, line: number, col?: number) => void;
  createPage: (name: string, parentDir?: string) => Promise<void>;
  renamePage: (oldPath: string, newName: string) => Promise<void>;
  deletePage: (relativePath: string) => Promise<void>;
  clearPendingTitleFocus: () => void;
  setCurrentPageHeadings: (headings: Heading[]) => void;
  setDirty: (dirty: boolean) => void;
  triggerReload: () => void;
  saveViewState: (path: string, scrollTop: number, cursor: number) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspacePath: null,
  pages: [],
  currentPagePath: null,
  pendingTitleFocus: false,
  pendingCursorLine: null,
  pendingCursorCol: null,
  pendingSection: null,
  currentPageHeadings: [],
  isDirty: false,
  reloadTrigger: 0,
  viewStates: {},
  graphReady: false,
  indexProgress: null,
  loading: false,
  error: null,

  openWorkspace: async (path: string) => {
    set({ loading: true, error: null, graphReady: false, indexProgress: null });
    try {
      const pages = await ipc.openWorkspace(path);
      set({ workspacePath: path, pages, loading: false });
      addRecentWorkspace(path);

      const unlisten = await listen<IndexProgress>("lit:index-progress", (event) => {
        set({ indexProgress: event.payload });
      });

      try {
        await ipc.ensureGraphReady(path);
        set({ graphReady: true });
      } catch (e) {
        set({ error: String(e) });
      } finally {
        unlisten();
      }
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
    set({ currentPagePath: relativePath, currentPageHeadings: [], isDirty: false, reloadTrigger: 0, pendingCursorLine: null, pendingSection: null });
  },

  selectPageAtLine: (relativePath: string, line: number, col?: number) => {
    set({ currentPagePath: relativePath, currentPageHeadings: [], isDirty: false, reloadTrigger: 0, pendingCursorLine: line, pendingCursorCol: col ?? null });
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
      set((state) => {
        const { [oldPath]: viewState, ...restViewStates } = state.viewStates;
        const newViewStates = viewState !== undefined
          ? { ...restViewStates, [newPath]: viewState }
          : restViewStates;
        return {
          pages: state.pages.map((p) =>
            p.relative_path === oldPath
              ? { ...p, title: newName, relative_path: newPath }
              : p,
          ),
          currentPagePath:
            state.currentPagePath === oldPath ? newPath : state.currentPagePath,
          viewStates: newViewStates,
        };
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearPendingTitleFocus: () => set({ pendingTitleFocus: false }),

  setCurrentPageHeadings: (headings: Heading[]) => set({ currentPageHeadings: headings }),

  setDirty: (dirty: boolean) => set({ isDirty: dirty }),

  triggerReload: () => set((state) => ({ reloadTrigger: state.reloadTrigger + 1 })),

  saveViewState: (path: string, scrollTop: number, cursor: number) =>
    set((state) => ({
      viewStates: { ...state.viewStates, [path]: { scrollTop, cursor } },
    })),

  deletePage: async (relativePath: string) => {
    try {
      await ipc.deletePage(relativePath);
      set((state) => {
        const viewStates = Object.fromEntries(
          Object.entries(state.viewStates).filter(([k]) => k !== relativePath),
        );
        return {
          pages: state.pages.filter((p) => p.relative_path !== relativePath),
          currentPagePath:
            state.currentPagePath === relativePath ? null : state.currentPagePath,
          viewStates,
        };
      });
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
