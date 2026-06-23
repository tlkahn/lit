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
      pageOffset: new Map(),
    });
  });

  afterEach(() => {
    resetEditorViewRef();
    usePanePdfLinkStore.setState({
      links: new Map(),
      lastSyncedPage: null,
      syncEnabled: true,
      pageOffset: new Map(),
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

  describe("skipGuards + clampIndex options", () => {
    it("dispatches even when syncEnabled is false (skipGuards)", () => {
      const view = makeFakeView();
      registerPaneView("ed1", view);
      usePanePdfLinkStore.setState({ syncEnabled: false });

      dispatchReverseSync(2, "ed1", markers, { skipGuards: true });

      expect(view.dispatch).toHaveBeenCalledTimes(1);
    });

    it("dispatches even when the editor has focus (skipGuards)", () => {
      const view = makeFakeView(1000, true);
      registerPaneView("ed1", view);

      dispatchReverseSync(2, "ed1", markers, { skipGuards: true });

      expect(view.dispatch).toHaveBeenCalledTimes(1);
    });

    it("clamps an out-of-bounds pageIndex to the last marker (clampIndex)", () => {
      const view = makeFakeView();
      registerPaneView("ed1", view);

      dispatchReverseSync(99, "ed1", markers, { clampIndex: true });

      expect(view.dispatch).toHaveBeenCalledTimes(1);
      const tx = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      // markers[2].charOffset === 120 (the last marker).
      expect(tx.selection.head).toBe(120);
    });

    it("records the CLAMPED index via setLastSyncedPage (clampIndex)", () => {
      const view = makeFakeView();
      registerPaneView("ed1", view);

      dispatchReverseSync(99, "ed1", markers, { clampIndex: true });

      // setLastSyncedPage records the effective (clamped) ARRAY index, which is
      // markers.length - 1 === 2 here, matching the existing page=index store
      // convention (see the "records lastSyncedPage BEFORE dispatch" test).
      expect(usePanePdfLinkStore.getState().lastSyncedPage?.page).toBe(2);
    });

    it("clamps a negative pageIndex to the first marker (clampIndex)", () => {
      const view = makeFakeView();
      registerPaneView("ed1", view);

      dispatchReverseSync(-2, "ed1", markers, { clampIndex: true });

      expect(view.dispatch).toHaveBeenCalledTimes(1);
      const tx = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      // markers[0].charOffset === 0 (the first marker).
      expect(tx.selection.head).toBe(0);
    });

    it("records clamped index 0 via setLastSyncedPage for negative pageIndex (clampIndex)", () => {
      const view = makeFakeView();
      registerPaneView("ed1", view);

      dispatchReverseSync(-2, "ed1", markers, { clampIndex: true });

      expect(usePanePdfLinkStore.getState().lastSyncedPage?.page).toBe(0);
    });

    it("is a no-op with clampIndex when markers is empty", () => {
      const view = makeFakeView();
      registerPaneView("ed1", view);

      dispatchReverseSync(99, "ed1", [], { clampIndex: true });

      expect(view.dispatch).not.toHaveBeenCalled();
      expect(usePanePdfLinkStore.getState().lastSyncedPage).toBeNull();
    });

    it("remains a no-op for an out-of-bounds pageIndex WITHOUT clampIndex", () => {
      const view = makeFakeView();
      registerPaneView("ed1", view);

      dispatchReverseSync(99, "ed1", markers);

      expect(view.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("page offset (centralized arithmetic)", () => {
    it("subtracts the stored page offset from pageIndex before looking up markers", () => {
      const view = makeFakeView();
      registerPaneView("ed1", view);
      usePanePdfLinkStore.setState({
        pageOffset: new Map([["ed1", 1]]),
      });

      // pageIndex 2, offset 1 => adjusted = 1 => markers[1].charOffset === 50
      dispatchReverseSync(2, "ed1", markers);

      expect(view.dispatch).toHaveBeenCalledTimes(1);
      const tx = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(tx.selection.head).toBe(50);
      // lastSyncedPage should record the adjusted index (1), not the raw PDF page (2)
      expect(usePanePdfLinkStore.getState().lastSyncedPage?.page).toBe(1);
    });

    it("clamps after subtracting offset (clampIndex)", () => {
      const view = makeFakeView();
      registerPaneView("ed1", view);
      usePanePdfLinkStore.setState({
        pageOffset: new Map([["ed1", 2]]),
      });

      // pageIndex 2, offset 2 => adjusted = 0, clamped to 0 => markers[0].charOffset === 0
      dispatchReverseSync(2, "ed1", markers, { clampIndex: true });

      expect(view.dispatch).toHaveBeenCalledTimes(1);
      const tx = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(tx.selection.head).toBe(0);
    });

    it("negative adjusted index is a no-op without clampIndex", () => {
      const view = makeFakeView();
      registerPaneView("ed1", view);
      usePanePdfLinkStore.setState({
        pageOffset: new Map([["ed1", 5]]),
      });

      // pageIndex 2, offset 5 => adjusted = -3 => markers[-3] is undefined => no-op
      dispatchReverseSync(2, "ed1", markers);

      expect(view.dispatch).not.toHaveBeenCalled();
    });

    it("negative adjusted index clamps to 0 with clampIndex", () => {
      const view = makeFakeView();
      registerPaneView("ed1", view);
      usePanePdfLinkStore.setState({
        pageOffset: new Map([["ed1", 5]]),
      });

      // pageIndex 2, offset 5 => adjusted = -3, clamped to 0 => markers[0].charOffset === 0
      dispatchReverseSync(2, "ed1", markers, { clampIndex: true });

      expect(view.dispatch).toHaveBeenCalledTimes(1);
      const tx = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(tx.selection.head).toBe(0);
    });
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
