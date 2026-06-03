import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBottomPanelEvents } from "./useBottomPanelEvents";
import { useBottomPanelStore, defaultTabMeta } from "../stores/bottomPanel";
import { usePreferencesStore } from "../stores/preferences";
import { usePaneStore } from "../stores/panes";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  annotationDataField,
  setAnnotationData,
} from "../editor/livePreview/annotationState";
import { setCurrentEditorView } from "../lib/editorViewRef";
import type { Annotation } from "../lib/ipc";

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    form: "compact",
    annotation_type: "note",
    certainty: "neutral",
    scope: { kind: "words", value: 0 },
    body: "test body",
    date: null,
    is_structured: true,
    char_start: 0,
    char_end: 10,
    original: "<!--- n | x --->",
    ...overrides,
  };
}

function setupEditorWithAnnotations(annotations: Annotation[]): EditorView {
  const state = EditorState.create({
    doc: "a".repeat(50),
    extensions: [annotationDataField],
  });
  const view = new EditorView({
    state,
    parent: document.createElement("div"),
  });
  if (annotations.length > 0) {
    view.dispatch({ effects: setAnnotationData.of(annotations) });
  }
  setCurrentEditorView(view);
  return view;
}

let testEditorView: EditorView | null = null;

beforeEach(() => {
  setCurrentEditorView(null);
  useBottomPanelStore.setState({
    activeTab: "linked",
    unfolded: false,
    panelHeight: 200,
    tabMeta: defaultTabMeta(),
  });
  usePreferencesStore.setState({
    experimentalUnlinkedReferences: true,
    annotationEnabled: true,
    annotationDisplayMode: "pill",
  });
  usePaneStore.setState({
    root: { type: "leaf", id: "p1", pagePath: "test.md" },
    focusedPaneId: "p1",
  });
});

afterEach(() => {
  testEditorView?.destroy();
  testEditorView = null;
  setCurrentEditorView(null);
});

describe("useBottomPanelEvents", () => {
  describe("lit:toggle-bottom-panel", () => {
    it("toggles unfolded from false to true", () => {
      renderHook(() => useBottomPanelEvents());

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:toggle-bottom-panel"));
      });

      expect(useBottomPanelStore.getState().unfolded).toBe(true);
    });

    it("toggles unfolded from true to false", () => {
      useBottomPanelStore.setState({ unfolded: true });
      renderHook(() => useBottomPanelEvents());

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:toggle-bottom-panel"));
      });

      expect(useBottomPanelStore.getState().unfolded).toBe(false);
    });

    it("dispatches lit:request-editor-focus when closing", async () => {
      useBottomPanelStore.setState({ unfolded: true });
      renderHook(() => useBottomPanelEvents());

      const spy = vi.fn();
      window.addEventListener("lit:request-editor-focus", spy);

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:toggle-bottom-panel"));
      });

      // queueMicrotask delivers the event asynchronously
      await waitFor(() => {
        expect(spy).toHaveBeenCalledTimes(1);
      });

      window.removeEventListener("lit:request-editor-focus", spy);
    });
  });

  describe("lit:annotations-changed", () => {
    it("updates annotationCount from editor state", () => {
      testEditorView = setupEditorWithAnnotations([
        makeAnnotation(),
        makeAnnotation({ char_start: 10, char_end: 20 }),
      ]);
      renderHook(() => useBottomPanelEvents());

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:annotations-changed"));
      });

      expect(useBottomPanelStore.getState().tabMeta.annotations.count).toBe(2);
    });

    it("sets annotationCount to 0 when no editor view", () => {
      useBottomPanelStore.getState().setTabCount("annotations", 5);
      renderHook(() => useBottomPanelEvents());

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:annotations-changed"));
      });

      expect(useBottomPanelStore.getState().tabMeta.annotations.count).toBe(0);
    });
  });

  describe("lit:show-annotation", () => {
    it("opens annotations tab when annotationEnabled and annotations exist", () => {
      useBottomPanelStore.getState().setTabCount("annotations", 3);
      renderHook(() => useBottomPanelEvents());

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:show-annotation"));
      });

      const state = useBottomPanelStore.getState();
      expect(state.tabMeta.annotations.hasOpened).toBe(true);
      expect(state.activeTab).toBe("annotations");
      expect(state.unfolded).toBe(true);
    });

    it("does nothing when annotationEnabled is false", () => {
      usePreferencesStore.setState({ annotationEnabled: false });
      useBottomPanelStore.getState().setTabCount("annotations", 3);
      renderHook(() => useBottomPanelEvents());

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:show-annotation"));
      });

      const state = useBottomPanelStore.getState();
      expect(state.activeTab).toBe("linked");
      expect(state.unfolded).toBe(false);
    });

    it("does nothing when annotationCount is 0", () => {
      renderHook(() => useBottomPanelEvents());

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:show-annotation"));
      });

      const state = useBottomPanelStore.getState();
      expect(state.activeTab).toBe("linked");
      expect(state.unfolded).toBe(false);
    });
  });

  describe("lit:toggle-annotation-panel", () => {
    it("opens annotations tab when folded", () => {
      useBottomPanelStore.getState().setTabCount("annotations", 2);
      renderHook(() => useBottomPanelEvents());

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:toggle-annotation-panel"));
      });

      const state = useBottomPanelStore.getState();
      expect(state.tabMeta.annotations.hasOpened).toBe(true);
      expect(state.activeTab).toBe("annotations");
      expect(state.unfolded).toBe(true);
    });

    it("folds when already on annotations tab and unfolded", () => {
      useBottomPanelStore.getState().setTabCount("annotations", 2);
      useBottomPanelStore.setState({
        activeTab: "annotations",
        unfolded: true,
      });
      renderHook(() => useBottomPanelEvents());

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:toggle-annotation-panel"));
      });

      expect(useBottomPanelStore.getState().unfolded).toBe(false);
    });

    it("opens annotations tab when folded and count is 0", () => {
      renderHook(() => useBottomPanelEvents());

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:toggle-annotation-panel"));
      });

      const state = useBottomPanelStore.getState();
      expect(state.activeTab).toBe("annotations");
      expect(state.unfolded).toBe(true);
    });

    it("switches to annotations tab when on different tab and unfolded", () => {
      useBottomPanelStore.getState().setTabCount("annotations", 2);
      useBottomPanelStore.setState({
        activeTab: "linked",
        unfolded: true,
      });
      renderHook(() => useBottomPanelEvents());

      act(() => {
        window.dispatchEvent(new CustomEvent("lit:toggle-annotation-panel"));
      });

      const state = useBottomPanelStore.getState();
      expect(state.activeTab).toBe("annotations");
      expect(state.unfolded).toBe(true);
      expect(state.tabMeta.annotations.hasOpened).toBe(true);
    });
  });

  describe("annotation display mode watcher", () => {
    it("shows annotations tab when mode changes to footnote and annotations exist", () => {
      useBottomPanelStore.getState().setTabCount("annotations", 2);
      renderHook(() => useBottomPanelEvents());

      act(() => {
        usePreferencesStore.setState({ annotationDisplayMode: "footnote" });
      });

      const state = useBottomPanelStore.getState();
      expect(state.tabMeta.annotations.hasOpened).toBe(true);
      expect(state.activeTab).toBe("annotations");
      expect(state.unfolded).toBe(true);
    });

    it("folds when mode changes to pill and on annotations tab", () => {
      // Start with footnote mode so the change to pill is detected
      usePreferencesStore.setState({ annotationDisplayMode: "footnote" });
      useBottomPanelStore.getState().setTabCount("annotations", 2);
      useBottomPanelStore.setState({
        activeTab: "annotations",
        unfolded: true,
      });
      renderHook(() => useBottomPanelEvents());

      act(() => {
        usePreferencesStore.setState({ annotationDisplayMode: "pill" });
      });

      expect(useBottomPanelStore.getState().unfolded).toBe(false);
    });

    it("does nothing when mode changes to pill on a different tab", () => {
      usePreferencesStore.setState({ annotationDisplayMode: "footnote" });
      useBottomPanelStore.setState({
        activeTab: "linked",
        unfolded: true,
      });
      renderHook(() => useBottomPanelEvents());

      act(() => {
        usePreferencesStore.setState({ annotationDisplayMode: "pill" });
      });

      const state = useBottomPanelStore.getState();
      expect(state.activeTab).toBe("linked");
      expect(state.unfolded).toBe(true);
    });
  });

  describe("preference guards", () => {
    it("switches to linked tab when annotationEnabled becomes false while on annotations tab", () => {
      useBottomPanelStore.setState({
        activeTab: "annotations",
        unfolded: true,
      });
      renderHook(() => useBottomPanelEvents());

      act(() => {
        usePreferencesStore.setState({ annotationEnabled: false });
      });

      const state = useBottomPanelStore.getState();
      expect(state.activeTab).toBe("linked");
      expect(state.unfolded).toBe(false);
    });

    it("switches to linked tab when experimentalUnlinkedReferences becomes false while on unlinked tab", () => {
      useBottomPanelStore.setState({
        activeTab: "unlinked",
        unfolded: true,
      });
      renderHook(() => useBottomPanelEvents());

      act(() => {
        usePreferencesStore.setState({
          experimentalUnlinkedReferences: false,
        });
      });

      const state = useBottomPanelStore.getState();
      expect(state.activeTab).toBe("linked");
      expect(state.unfolded).toBe(false);
    });
  });

  describe("annotation count fallback", () => {
    it("switches to linked tab when annotationCount drops to 0 while on annotations tab", () => {
      useBottomPanelStore.getState().setTabCount("annotations", 3);
      useBottomPanelStore.setState({
        activeTab: "annotations",
        unfolded: true,
      });
      renderHook(() => useBottomPanelEvents());

      act(() => {
        useBottomPanelStore.getState().setTabCount("annotations", 0);
      });

      expect(useBottomPanelStore.getState().activeTab).toBe("linked");
    });

    it("does NOT reset activeTab when annotations tab is clicked with default count 0", () => {
      renderHook(() => useBottomPanelEvents());

      act(() => {
        useBottomPanelStore.getState().handleTabClick("annotations");
      });

      const state = useBottomPanelStore.getState();
      expect(state.activeTab).toBe("annotations");
      expect(state.unfolded).toBe(true);
    });

    it("allows toggle (second click folds) when annotations tab has count 0", () => {
      renderHook(() => useBottomPanelEvents());

      act(() => {
        useBottomPanelStore.getState().handleTabClick("annotations");
      });
      expect(useBottomPanelStore.getState().activeTab).toBe("annotations");
      expect(useBottomPanelStore.getState().unfolded).toBe(true);

      act(() => {
        useBottomPanelStore.getState().handleTabClick("annotations");
      });
      expect(useBottomPanelStore.getState().unfolded).toBe(false);
    });
  });

  describe("page change reset", () => {
    it("calls resetForPage when focused pane page changes", () => {
      useBottomPanelStore.getState().setTabCount("annotations", 5);
      useBottomPanelStore.getState().markOpened("annotations");
      useBottomPanelStore.getState().markOpened("unlinked");
      renderHook(() => useBottomPanelEvents());

      // Spy on resetForPage after hook is set up
      const originalResetForPage =
        useBottomPanelStore.getState().resetForPage;
      const spiedReset = vi.fn((...args: Parameters<typeof originalResetForPage>) => {
        return originalResetForPage(...args);
      });
      useBottomPanelStore.setState({ resetForPage: spiedReset });

      act(() => {
        usePaneStore.setState({
          root: { type: "leaf", id: "p1", pagePath: "other.md" },
          focusedPaneId: "p1",
        });
      });

      expect(spiedReset).toHaveBeenCalled();
      const state = useBottomPanelStore.getState();
      expect(state.tabMeta.annotations.count).toBe(0);
      expect(state.tabMeta.annotations.hasOpened).toBe(false);
    });

    it("resets linkedCount to null when focused pane page changes", () => {
      useBottomPanelStore.getState().setTabCount("linked", 5);
      renderHook(() => useBottomPanelEvents());

      act(() => {
        usePaneStore.setState({
          root: { type: "leaf", id: "p1", pagePath: "other.md" },
          focusedPaneId: "p1",
        });
      });

      expect(useBottomPanelStore.getState().tabMeta.linked.count).toBe(null);
    });

    it("folds the panel when focused pane page changes", () => {
      useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
      renderHook(() => useBottomPanelEvents());

      act(() => {
        usePaneStore.setState({
          root: { type: "leaf", id: "p1", pagePath: "other.md" },
          focusedPaneId: "p1",
        });
      });

      expect(useBottomPanelStore.getState().unfolded).toBe(false);
    });

    it("folds panel when page becomes null and active tab is page-dependent", () => {
      useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
      renderHook(() => useBottomPanelEvents());

      act(() => {
        usePaneStore.setState({
          root: { type: "leaf", id: "p1", pagePath: null },
          focusedPaneId: "p1",
        });
      });

      expect(useBottomPanelStore.getState().unfolded).toBe(false);
    });

    it("stays open when page becomes null and active tab is llm-response", () => {
      useBottomPanelStore.getState().markOpened("llm-response");
      useBottomPanelStore.setState({ unfolded: true, activeTab: "llm-response" });
      renderHook(() => useBottomPanelEvents());

      act(() => {
        usePaneStore.setState({
          root: { type: "leaf", id: "p1", pagePath: null },
          focusedPaneId: "p1",
        });
      });

      expect(useBottomPanelStore.getState().unfolded).toBe(true);
    });
  });
});
