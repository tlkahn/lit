import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import * as ipc from "../lib/ipc";
import type { PageMeta, IndexProgress } from "../lib/ipc";
import type { Heading } from "../lib/headings";
import {
  usePaneStore,
  createInitialState,
  startLayoutSync,
  stopLayoutSync,
  startGraphViewGuard,
  stopGraphViewGuard,
  collectLeaves,
} from "./panes";
import {
  initPanePdfLinkCleanup,
  usePanePdfLinkStore,
  deserializeLinks,
} from "./panePdfLink";
import { usePaneHistoryStore, initPaneHistoryTracking, setPageExistsCheck, deserializeHistory, type PaneHistoryStack } from "./paneHistory";
import { renamePath as renameSharedDocPath, flushSave } from "../lib/sharedDocs";
import {
  loadLayout,
  validateLayout,
  validateFocusedPaneId,
  pruneViewStates,
  cleanupStaleLayouts,
} from "../lib/paneLayout";

const RECENT_KEY = "lit-recent-workspaces";
const LEGACY_KEY = "lit-workspace-path";
const MAX_RECENT = 10;

import type { ViewState } from "../types";
import { DEFAULT_VIEW_STATE } from "../types";

export type { ViewState };

export interface WorkspaceStore {
  workspacePath: string | null;
  pages: PageMeta[];
  currentPagePath: string | null;
  pendingCursorLine: number | null;
  pendingCursorCol: number | null;
  pendingCursorFileAbsolute: boolean;
  pendingSection: string | null;
  pendingEditorFocus: boolean;
  currentPageHeadings: Heading[];
  currentFrontmatterLineCount: number;
  isDirty: boolean;
  reloadTrigger: number;
  viewStates: Record<string, ViewState>;
  graphReady: boolean;
  indexProgress: IndexProgress | null;
  loading: boolean;
  error: string | null;
  pendingRenameOldPaths: string[];

  openWorkspace: (path: string) => Promise<void>;
  refreshPages: () => Promise<void>;
  selectPage: (relativePath: string | null) => void;
  selectPageAtLine: (relativePath: string, line: number, col?: number, fileAbsolute?: boolean) => void;
  createPage: (name: string, parentDir?: string) => Promise<void>;
  clearPendingEditorFocus: () => void;
  renamePage: (oldPath: string, newName: string) => Promise<string>;
  deletePage: (relativePath: string) => Promise<void>;
  setCurrentPageHeadings: (headings: Heading[]) => void;
  setCurrentFrontmatterLineCount: (count: number) => void;
  setDirty: (dirty: boolean) => void;
  triggerReload: () => void;
  saveViewState: (path: string, scrollTop: number, cursor: number) => void;
  saveMindmapFoldState: (path: string, ids: string[]) => void;
  paneViewStates: Record<string, ViewState>;
  savePaneViewState: (paneId: string, scrollTop: number, cursor: number) => void;
  removePaneViewState: (paneId: string) => void;
  savePaneMindmapFoldState: (paneId: string, ids: string[]) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspacePath: null,
  pages: [],
  currentPagePath: null,
  pendingCursorLine: null,
  pendingCursorCol: null,
  pendingCursorFileAbsolute: false,
  pendingSection: null,
  pendingEditorFocus: false,
  currentPageHeadings: [],
  currentFrontmatterLineCount: 0,
  isDirty: false,
  reloadTrigger: 0,
  viewStates: {},
  paneViewStates: {},
  graphReady: false,
  indexProgress: null,
  loading: false,
  error: null,
  pendingRenameOldPaths: [],

  openWorkspace: async (path: string) => {
    set({ loading: true, error: null, graphReady: false, indexProgress: null });
    try {
      const pages = await ipc.openWorkspace(path);
      set({ workspacePath: path, pages, loading: false, pendingRenameOldPaths: [] });
      addRecentWorkspace(path);

      stopLayoutSync();
      stopGraphViewGuard();
      cleanupStaleLayouts();
      const stored = loadLayout(path);
      if (stored) {
        const pageSet = new Set(pages.map((p) => p.relative_path));
        const validRoot = validateLayout(stored.root, pageSet);
        const validFocus = validateFocusedPaneId(validRoot, stored.focusedPaneId);
        const validViewStates = pruneViewStates(stored.paneViewStates, validRoot);
        usePaneStore.setState({ root: validRoot, focusedPaneId: validFocus });
        set({ paneViewStates: validViewStates });
        // Restore PDF links, dropping any pair whose endpoints are no longer
        // live leaves after validation (mirrors pruneViewStates).
        const liveIds = new Set(collectLeaves(validRoot).map((l) => l.id));
        const validLinks = stored.pdfLinks.filter(
          ([x, y]) => liveIds.has(x) && liveIds.has(y),
        );
        // Restore page offsets, dropping entries for pane IDs that no longer
        // exist in the validated layout tree (same pruning as pdfLinks).
        const validPageOffsets = new Map<string, number>();
        for (const [id, offset] of Object.entries(stored.pageOffsets ?? {})) {
          if (liveIds.has(id)) validPageOffsets.set(id, offset);
        }
        usePanePdfLinkStore.setState({ links: deserializeLinks(validLinks), pageOffset: validPageOffsets });
        // Restore pane history, dropping entries for pane IDs that no longer
        // exist in the validated layout tree (same pruning as pdfLinks).
        const validHistory: Record<string, PaneHistoryStack> = {};
        for (const [id, stack] of Object.entries(stored.paneHistory ?? {})) {
          if (liveIds.has(id)) validHistory[id] = stack;
        }
        usePaneHistoryStore.setState({ stacks: deserializeHistory(validHistory) });
      } else {
        usePaneStore.setState(createInitialState());
        set({ paneViewStates: {} });
        usePanePdfLinkStore.setState({ links: new Map() });
        usePaneHistoryStore.setState({ stacks: new Map() });
      }
      startLayoutSync(path, () => get().paneViewStates);
      startGraphViewGuard();
      initPanePdfLinkCleanup();
      initPaneHistoryTracking();
      setPageExistsCheck((path) => {
        const pages = useWorkspaceStore.getState().pages;
        if (pages.length === 0) return true;
        return pages.some((p) => p.relative_path === path);
      });

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
      set({ loading: false, error: String(e), pendingRenameOldPaths: [] });
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
    set({ currentPagePath: relativePath, currentPageHeadings: [], isDirty: false, reloadTrigger: 0, pendingCursorLine: null, pendingCursorFileAbsolute: false, pendingSection: null });
  },

  selectPageAtLine: (relativePath: string, line: number, col?: number, fileAbsolute?: boolean) => {
    set({ currentPagePath: relativePath, currentPageHeadings: [], isDirty: false, reloadTrigger: 0, pendingCursorLine: line, pendingCursorCol: col ?? null, pendingCursorFileAbsolute: fileAbsolute ?? false });
  },

  createPage: async (name: string, parentDir?: string) => {
    try {
      const meta = await ipc.createPage(name, parentDir);
      set((state) => ({
        pages: [...state.pages, meta],
        currentPagePath: meta.relative_path,
        // Create wants the editor caret in the focused pane once the new page
        // is loaded. The focused EditorPane consumes this flag (view.focus)
        // and clears it; see src/components/EditorPane.tsx. Visible caret on
        // the empty page also needs drawSelection() in the CM extensions.
        pendingEditorFocus: true,
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearPendingEditorFocus: () => set({ pendingEditorFocus: false }),

  renamePage: async (oldPath: string, newName: string) => {
    set((s) => ({
      error: null,
      pendingRenameOldPaths: s.pendingRenameOldPaths.includes(oldPath)
        ? s.pendingRenameOldPaths
        : [...s.pendingRenameOldPaths, oldPath],
    }));
    try {
      await flushSave(oldPath);
      const newPath = await ipc.renamePage(oldPath, newName);
      // sharedDocs must rekey before pane paths flip. usePageContent cleanup
      // calls release(oldPath); after the rekey that release is a no-op and
      // acquire(newPath) reuses the moved doc (panes set + edit/save gens
      // preserved), so the dirty state survives the path change.
      renameSharedDocPath(oldPath, newPath, { title: newName });
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
      // Pending is cleared in finally, AFTER pane + history repath, so the
      // mid-repath window is genuinely guarded.
      usePaneStore.getState().renamePagePath(oldPath, newPath);
      usePaneHistoryStore.getState().renamePath(oldPath, newPath);
      return newPath;
    } catch (e) {
      set({ error: String(e) });
      throw e instanceof Error ? e : new Error(String(e));
    } finally {
      // Success and failure both clear here; filter is idempotent.
      set((s) => ({
        pendingRenameOldPaths: s.pendingRenameOldPaths.filter((p) => p !== oldPath),
      }));
    }
  },

  setCurrentPageHeadings: (headings: Heading[]) => set({ currentPageHeadings: headings }),

  setCurrentFrontmatterLineCount: (count: number) => set({ currentFrontmatterLineCount: count }),

  setDirty: (dirty: boolean) => set({ isDirty: dirty }),

  triggerReload: () => set((state) => ({ reloadTrigger: state.reloadTrigger + 1 })),

  saveViewState: (path: string, scrollTop: number, cursor: number) =>
    set((state) => ({
      viewStates: { ...state.viewStates, [path]: { ...(state.viewStates[path] ?? DEFAULT_VIEW_STATE), scrollTop, cursor } },
    })),

  saveMindmapFoldState: (path: string, ids: string[]) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [path]: { ...(state.viewStates[path] ?? DEFAULT_VIEW_STATE), mindmapFoldedIds: ids },
      },
    })),

  savePaneViewState: (paneId: string, scrollTop: number, cursor: number) =>
    set((state) => ({
      paneViewStates: { ...state.paneViewStates, [paneId]: { ...(state.paneViewStates[paneId] ?? DEFAULT_VIEW_STATE), scrollTop, cursor } },
    })),

  removePaneViewState: (paneId: string) =>
    set((state) => ({
      paneViewStates: Object.fromEntries(
        Object.entries(state.paneViewStates).filter(([k]) => k !== paneId),
      ),
    })),

  savePaneMindmapFoldState: (paneId: string, ids: string[]) =>
    set((state) => ({
      paneViewStates: {
        ...state.paneViewStates,
        [paneId]: { ...(state.paneViewStates[paneId] ?? DEFAULT_VIEW_STATE), mindmapFoldedIds: ids },
      },
    })),

  deletePage: async (relativePath: string) => {
    try {
      await ipc.trashPage(relativePath);
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
      usePaneStore.getState().clearPageFromPanes(relativePath);
      usePaneHistoryStore.getState().clearPath(relativePath);
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
