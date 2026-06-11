import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { readPage, previewSplit } from "./ipc";
import type { PageContent, SplitPlan } from "./ipc";

export async function showTrashContextMenu(trashName: string): Promise<void> {
  return invoke<void>("show_trash_context_menu", { trashName });
}

interface TrashContextPayload {
  trash_name: string;
}

interface TrashContextMenuHandlers {
  onRestore: (trashName: string) => void;
  onPurge: (trashName: string) => void;
}

export async function showSidebarContextMenu(relativePath: string): Promise<void> {
  return invoke<void>("show_sidebar_context_menu", { relativePath });
}

interface SidebarContextPayload {
  relative_path: string;
}

interface SidebarContextMenuHandlers {
  onRename: (relativePath: string) => void;
  onExternalEditor: (relativePath: string) => void;
  onExportNetwork: (relativePath: string) => void;
  onTrash: (relativePath: string) => void;
}

export function useSidebarContextMenu(handlers: SidebarContextMenuHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<Promise<() => void>> = [];

    unlisteners.push(
      listen<SidebarContextPayload>("context-menu://sidebar/rename", (event) => {
        if (!cancelled) handlersRef.current.onRename(event.payload.relative_path);
      }),
    );

    unlisteners.push(
      listen<SidebarContextPayload>("context-menu://sidebar/external-editor", (event) => {
        if (!cancelled) handlersRef.current.onExternalEditor(event.payload.relative_path);
      }),
    );

    unlisteners.push(
      listen<SidebarContextPayload>("context-menu://sidebar/export-network", (event) => {
        if (!cancelled) handlersRef.current.onExportNetwork(event.payload.relative_path);
      }),
    );

    unlisteners.push(
      listen<SidebarContextPayload>("context-menu://sidebar/trash", (event) => {
        if (!cancelled) handlersRef.current.onTrash(event.payload.relative_path);
      }),
    );

    return () => {
      cancelled = true;
      for (const p of unlisteners) p.then((u) => u());
    };
  }, []);
}

export async function showMindmapContextMenu(nodeId: string, hasExport: boolean): Promise<void> {
  return invoke<void>("show_mindmap_context_menu", { nodeId, hasExport });
}

interface MindmapContextPayload {
  node_id: string;
}

interface MindmapContextMenuHandlers {
  onEdit: (nodeId: string) => void;
  onExportNetwork: (nodeId: string) => void;
}

export function useMindmapContextMenu(handlers: MindmapContextMenuHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<Promise<() => void>> = [];

    unlisteners.push(
      listen<MindmapContextPayload>("context-menu://mindmap/edit", (event) => {
        if (!cancelled) handlersRef.current.onEdit(event.payload.node_id);
      }),
    );

    unlisteners.push(
      listen<MindmapContextPayload>("context-menu://mindmap/export-network", (event) => {
        if (!cancelled) handlersRef.current.onExportNetwork(event.payload.node_id);
      }),
    );

    return () => {
      cancelled = true;
      for (const p of unlisteners) p.then((u) => u());
    };
  }, []);
}

export function useTrashContextMenu(handlers: TrashContextMenuHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<Promise<() => void>> = [];

    unlisteners.push(
      listen<TrashContextPayload>("context-menu://trash/restore", (event) => {
        if (!cancelled) handlersRef.current.onRestore(event.payload.trash_name);
      }),
    );

    unlisteners.push(
      listen<TrashContextPayload>("context-menu://trash/purge", (event) => {
        if (!cancelled) handlersRef.current.onPurge(event.payload.trash_name);
      }),
    );

    return () => {
      cancelled = true;
      for (const p of unlisteners) p.then((u) => u());
    };
  }, []);
}

interface GraphContextMenuArgs {
  nodeId: string;
  nodeIds: string[];
  selectionCount: number;
  hasHeadings: boolean;
  hasExport: boolean;
  isShadow: boolean;
}

export async function showGraphContextMenu(args: GraphContextMenuArgs): Promise<void> {
  return invoke<void>("show_graph_context_menu", { ...args });
}

interface GraphContextPayload {
  node_id: string;
  node_ids: string[];
}

interface GraphContextMenuHandlers {
  onMergeRequest: (docs: PageContent[]) => void;
  onSplitRequest: (plan: SplitPlan, nodeId: string) => void;
  onDeleteRequest: (nodeIds: string[], labels: string[]) => void;
  onExportNetwork: (nodeId: string) => void;
  onFetchDetails: (nodeId: string) => void;
  onCreateNote: (nodeId: string) => void;
  getNodeLabel: (nodeId: string) => string;
}

export function useGraphContextMenu(handlers: GraphContextMenuHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<Promise<() => void>> = [];

    unlisteners.push(
      listen<GraphContextPayload>("context-menu://graph/merge", (event) => {
        if (cancelled) return;
        const { node_ids } = event.payload;
        Promise.all(node_ids.map((id) => readPage(id))).then((docs) => {
          if (!cancelled) handlersRef.current.onMergeRequest(docs);
        });
      }),
    );

    unlisteners.push(
      listen<GraphContextPayload>("context-menu://graph/split", (event) => {
        if (cancelled) return;
        const { node_id } = event.payload;
        readPage(node_id).then((page) => {
          if (cancelled) return;
          return previewSplit(page.body, page.meta.title, page.meta.frontmatter).then((plan) => {
            if (!cancelled) handlersRef.current.onSplitRequest(plan, node_id);
          });
        });
      }),
    );

    unlisteners.push(
      listen<GraphContextPayload>("context-menu://graph/delete", (event) => {
        if (cancelled) return;
        const { node_ids } = event.payload;
        const labels = node_ids.map((id) => handlersRef.current.getNodeLabel(id));
        handlersRef.current.onDeleteRequest(node_ids, labels);
      }),
    );

    unlisteners.push(
      listen<GraphContextPayload>("context-menu://graph/export-network", (event) => {
        if (!cancelled) handlersRef.current.onExportNetwork(event.payload.node_id);
      }),
    );

    unlisteners.push(
      listen<GraphContextPayload>("context-menu://graph/fetch-details", (event) => {
        if (!cancelled) handlersRef.current.onFetchDetails(event.payload.node_id);
      }),
    );

    unlisteners.push(
      listen<GraphContextPayload>("context-menu://graph/create-note", (event) => {
        if (!cancelled) handlersRef.current.onCreateNote(event.payload.node_id);
      }),
    );

    return () => {
      cancelled = true;
      for (const p of unlisteners) p.then((u) => u());
    };
  }, []);
}
