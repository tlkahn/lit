import { useEffect, useRef } from "react";
import { useBottomPanelStore } from "../stores/bottomPanel";
import { usePreferencesStore } from "../stores/preferences";
import { usePaneStore, findLeaf } from "../stores/panes";
import { getCurrentEditorView } from "../lib/editorViewRef";
import { annotationDataField } from "../editor/livePreview/annotationState";
import type { AnnotationDisplayMode } from "../stores/preferences";

export function useBottomPanelEvents() {
  const prevDisplayModeRef = useRef<AnnotationDisplayMode>(
    usePreferencesStore.getState().annotationDisplayMode,
  );

  // lit:toggle-bottom-panel
  useEffect(() => {
    const handler = () => {
      const store = useBottomPanelStore.getState();
      if (store.unfolded) {
        store.setUnfolded(false);
        queueMicrotask(() =>
          window.dispatchEvent(new CustomEvent("lit:request-editor-focus")),
        );
      } else {
        store.setUnfolded(true);
      }
    };
    window.addEventListener("lit:toggle-bottom-panel", handler);
    return () => window.removeEventListener("lit:toggle-bottom-panel", handler);
  }, []);

  // lit:annotations-changed
  useEffect(() => {
    const handler = () => {
      const view = getCurrentEditorView();
      if (!view) {
        useBottomPanelStore.getState().setAnnotationCount(0);
        return;
      }
      const data = view.state.field(annotationDataField, false);
      useBottomPanelStore.getState().setAnnotationCount(data ? data.length : 0);
    };
    window.addEventListener("lit:annotations-changed", handler);
    return () => window.removeEventListener("lit:annotations-changed", handler);
  }, []);

  // lit:show-annotation
  useEffect(() => {
    const handler = () => {
      const { annotationEnabled } = usePreferencesStore.getState();
      const { annotationCount } = useBottomPanelStore.getState();
      if (annotationEnabled && annotationCount > 0) {
        useBottomPanelStore.setState({
          hasOpenedAnnotations: true,
          activeTab: "annotations",
          unfolded: true,
        });
      }
    };
    window.addEventListener("lit:show-annotation", handler);
    return () => window.removeEventListener("lit:show-annotation", handler);
  }, []);

  // lit:toggle-annotation-panel
  useEffect(() => {
    const handler = () => {
      const { annotationEnabled } = usePreferencesStore.getState();
      const store = useBottomPanelStore.getState();
      if (!annotationEnabled || store.annotationCount === 0) return;
      if (store.unfolded && store.activeTab === "annotations") {
        store.setUnfolded(false);
      } else {
        useBottomPanelStore.setState({
          hasOpenedAnnotations: true,
          activeTab: "annotations",
          unfolded: true,
        });
      }
    };
    window.addEventListener("lit:toggle-annotation-panel", handler);
    return () => window.removeEventListener("lit:toggle-annotation-panel", handler);
  }, []);

  // Annotation display mode watcher
  useEffect(() => {
    return usePreferencesStore.subscribe((state) => {
      const prev = prevDisplayModeRef.current;
      prevDisplayModeRef.current = state.annotationDisplayMode;
      if (prev === state.annotationDisplayMode) return;

      const store = useBottomPanelStore.getState();
      if (state.annotationEnabled && state.annotationDisplayMode === "footnote" && store.annotationCount > 0) {
        useBottomPanelStore.setState({
          hasOpenedAnnotations: true,
          activeTab: "annotations",
          unfolded: true,
        });
      } else if (state.annotationDisplayMode === "pill" && store.activeTab === "annotations") {
        store.setUnfolded(false);
      }
    });
  }, []);

  // Preference guards: close unlinked/annotations tab when feature disabled
  useEffect(() => {
    return usePreferencesStore.subscribe((state) => {
      const store = useBottomPanelStore.getState();
      if (!state.annotationEnabled && store.activeTab === "annotations") {
        useBottomPanelStore.setState({ activeTab: "linked", unfolded: false });
      }
      if (!state.experimentalUnlinkedReferences && store.activeTab === "unlinked") {
        useBottomPanelStore.setState({ activeTab: "linked", unfolded: false });
      }
    });
  }, []);

  // Annotation count → fall back to linked when annotations disappear
  useEffect(() => {
    return useBottomPanelStore.subscribe((state) => {
      if (state.annotationCount === 0 && state.activeTab === "annotations") {
        useBottomPanelStore.setState({ activeTab: "linked" });
      }
    });
  }, []);

  // Page-change reset: subscribe to pane store
  useEffect(() => {
    let lastPagePath: string | null = null;
    const updatePage = () => {
      const paneState = usePaneStore.getState();
      const leaf = findLeaf(paneState.root, paneState.focusedPaneId);
      return leaf?.pagePath ?? null;
    };
    lastPagePath = updatePage();

    return usePaneStore.subscribe(() => {
      const currentPage = updatePage();
      if (currentPage !== lastPagePath) {
        lastPagePath = currentPage;
        if (currentPage !== null) {
          useBottomPanelStore.getState().resetForPage();
        }
      }
    });
  }, []);
}
