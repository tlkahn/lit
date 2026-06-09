import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import {
  registerPaneView,
  _resetForTesting as resetEditorViewRef,
} from "./editorViewRef";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import { dispatchReverseSync } from "./reverseSync";
import type { PageMarker } from "./pageMarkers";

const markers: PageMarker[] = [
  { page: 1, charOffset: 0 },
  { page: 2, charOffset: 50 },
  { page: 3, charOffset: 120 },
];

/** Minimal EditorView stub exposing only what reverseSync touches. */
function makeFakeView(docLength = 1000, hasFocus = false): EditorView {
  return {
    hasFocus,
    state: {
      doc: { length: docLength },
      selection: { main: { head: 0 } },
    },
    dispatch: vi.fn(),
  } as unknown as EditorView;
}

describe("dispatchReverseSync", () => {
  beforeEach(() => {
    resetEditorViewRef();
    usePanePdfLinkStore.setState({
      links: new Map(),
      lastSyncedPage: null,
      syncEnabled: true,
    });
  });

  afterEach(() => {
    resetEditorViewRef();
    usePanePdfLinkStore.setState({
      links: new Map(),
      lastSyncedPage: null,
      syncEnabled: true,
    });
  });

  describe("sync toggle", () => {
    it("does not dispatch or record lastSyncedPage when syncEnabled is false", () => {
      const view = makeFakeView();
      registerPaneView("ed1", view);
      usePanePdfLinkStore.setState({ syncEnabled: false });

      dispatchReverseSync(2, "ed1", markers);

      expect(view.dispatch).not.toHaveBeenCalled();
      expect(usePanePdfLinkStore.getState().lastSyncedPage).toBeNull();
    });

    it("dispatches when syncEnabled is true (regression)", () => {
      const view = makeFakeView();
      registerPaneView("ed1", view);
      usePanePdfLinkStore.setState({ syncEnabled: true });

      dispatchReverseSync(2, "ed1", markers);

      expect(view.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  it("scrolls the linked editor to markers[pageIndex].charOffset", () => {
    const view = makeFakeView();
    registerPaneView("ed1", view);

    dispatchReverseSync(2, "ed1", markers);

    expect(view.dispatch).toHaveBeenCalledTimes(1);
    const tx = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // Cursor target derives from markers[2].charOffset === 120.
    // EditorSelection.cursor(pos) returns a SelectionRange with .head.
    expect(tx.selection.head).toBe(120);
    // scrollIntoView effect targets the same position.
    expect(tx.effects).toBeTruthy();
  });

  it("is a no-op when markers is empty (no marker for the index)", () => {
    const view = makeFakeView();
    registerPaneView("ed1", view);

    dispatchReverseSync(0, "ed1", []);

    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("is a no-op when pageIndex is beyond markers.length", () => {
    const view = makeFakeView();
    registerPaneView("ed1", view);

    dispatchReverseSync(99, "ed1", markers);

    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does not throw when no view is registered for the id", () => {
    expect(() => dispatchReverseSync(1, "missing", markers)).not.toThrow();
  });

  it("records lastSyncedPage in the store BEFORE dispatching to the view", () => {
    let pageAtDispatchTime: number | null = null;
    const view = {
      state: {
        doc: { length: 1000 },
        selection: { main: { head: 0 } },
      },
      dispatch: vi.fn(() => {
        pageAtDispatchTime =
          usePanePdfLinkStore.getState().lastSyncedPage?.page ?? null;
      }),
    } as unknown as EditorView;
    registerPaneView("ed1", view);

    dispatchReverseSync(2, "ed1", markers);

    // The store already held page 2 by the time dispatch ran.
    expect(pageAtDispatchTime).toBe(2);
    expect(usePanePdfLinkStore.getState().lastSyncedPage?.page).toBe(2);
  });

  it("does NOT record lastSyncedPage on a no-op (no marker)", () => {
    const view = makeFakeView();
    registerPaneView("ed1", view);

    dispatchReverseSync(99, "ed1", markers);

    expect(usePanePdfLinkStore.getState().lastSyncedPage).toBeNull();
  });

  it("clamps the cursor position to the doc length", () => {
    const view = makeFakeView(60);
    registerPaneView("ed1", view);

    dispatchReverseSync(2, "ed1", markers);

    const tx = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(tx.selection.head).toBe(60);
  });

  it("does not call console.log on any code path", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // Path 1: syncEnabled=false
      usePanePdfLinkStore.setState({ syncEnabled: false });
      dispatchReverseSync(2, "ed1", markers);
      // Path 2: no marker
      usePanePdfLinkStore.setState({ syncEnabled: true });
      dispatchReverseSync(99, "missing", markers);
      // Path 3: no view
      dispatchReverseSync(0, "missing", markers);
      // Path 4: editor has focus
      const focusView = makeFakeView(1000, true);
      registerPaneView("ed1", focusView);
      dispatchReverseSync(2, "ed1", markers);
      // Path 5: normal dispatch
      const view = makeFakeView(1000, false);
      registerPaneView("ed2", view);
      dispatchReverseSync(1, "ed2", markers);

      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  describe("editor focus guard", () => {
    it("does not dispatch when editor has focus", () => {
      const view = makeFakeView(1000, true);
      registerPaneView("ed1", view);

      dispatchReverseSync(2, "ed1", markers);

      expect(view.dispatch).not.toHaveBeenCalled();
    });

    it("does not record lastSyncedPage when editor has focus", () => {
      const view = makeFakeView(1000, true);
      registerPaneView("ed1", view);

      dispatchReverseSync(2, "ed1", markers);

      expect(usePanePdfLinkStore.getState().lastSyncedPage).toBeNull();
    });

    it("dispatches normally when editor does not have focus", () => {
      const view = makeFakeView(1000, false);
      registerPaneView("ed1", view);

      dispatchReverseSync(2, "ed1", markers);

      expect(view.dispatch).toHaveBeenCalledTimes(1);
    });
  });
});
