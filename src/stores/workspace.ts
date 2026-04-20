import { create } from "zustand";
import * as ipc from "../lib/ipc";
import type { PageMeta } from "../lib/ipc";

const STORAGE_KEY = "lit-workspace-path";

export interface WorkspaceStore {
  workspacePath: string | null;
  pages: PageMeta[];
  currentPagePath: string | null;
  loading: boolean;
  error: string | null;

  openWorkspace: (path: string) => Promise<void>;
  refreshPages: () => Promise<void>;
  selectPage: (relativePath: string | null) => void;
  createPage: (name: string, parentDir?: string) => Promise<void>;
  renamePage: (oldPath: string, newName: string) => Promise<void>;
  deletePage: (relativePath: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspacePath: null,
  pages: [],
  currentPagePath: null,
  loading: false,
  error: null,

  openWorkspace: async (path: string) => {
    set({ loading: true, error: null });
    try {
      const pages = await ipc.openWorkspace(path);
      set({ workspacePath: path, pages, loading: false });
      localStorage.setItem(STORAGE_KEY, path);
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
    set({ currentPagePath: relativePath });
  },

  createPage: async (name: string, parentDir?: string) => {
    try {
      const meta = await ipc.createPage(name, parentDir);
      set((state) => ({ pages: [...state.pages, meta] }));
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

export function getSavedWorkspacePath(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}
