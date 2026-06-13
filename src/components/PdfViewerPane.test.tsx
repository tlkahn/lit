import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import { Text } from "@codemirror/state";
import { usePaneStore } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import * as pdfPaneRef from "../lib/pdfPaneRef";
import {
  registerPaneView,
  setFocusedPane,
  getCurrentEditorView,
  _resetForTesting as resetEditorViewRef,
} from "../lib/editorViewRef";
import { _resetMarkerCacheForTesting as resetMarkerCache } from "../lib/pageMarkers";

const mockGoToPage = vi.fn();

// Controls the readiness flag the mocked PdfViewer passes to registerGoToPage.
// Defaults to true so existing tests register a ready closure on mount.
let mockReady = true;

vi.mock("./PdfViewer", () => ({
  PdfViewer: ({
    filePath,
    paneId,
    registerGoToPage,
    onPageChange,
    onPageCount,
  }: {
    filePath: string;
    paneId: string;
    registerGoToPage?: (fn: (i: number) => void, ready: boolean) => void;
    onPageChange?: (i: number) => void;
    onPageCount?: (count: number) => void;
  }) => {
    // Simulate PdfViewer publishing its internal goToPage on mount, carrying a
    // readiness flag (false before the PDF document loads, true once loaded).
    useEffect(() => {
      registerGoToPage?.(mockGoToPage, mockReady);
    }, [registerGoToPage]);
    // Expose buttons the test can click to drive callbacks, plus a button that
    // re-registers with ready=true to mimic the second (ready) registration.
    return (
      <div data-testid={`pdf-viewer-${filePath}-${paneId}`}>
        <button data-testid="fire-page-change" onClick={() => onPageChange?.(2)} />
        <button data-testid="fire-page-count" onClick={() => onPageCount?.(10)} />
        <button
          data-testid="register-ready"
          onClick={() => registerGoToPage?.(mockGoToPage, true)}
        />
      </div>
    );
  },
}));

import { PdfViewerPane } from "./PdfViewerPane";

/** Fake EditorView with a real Text object so getCachedPageMarkers can scan it. */
function makeFakeEditorView(doc: string): EditorView {
  return {
    hasFocus: false,
    state: {
      doc: Text.of(doc.split("\n")),
      selection: { main: { head: 0 } },
    },
    dispatch: vi.fn(),
  } as unknown as EditorView;
}

beforeEach(() => {
  usePaneStore.setState({
    root: { type: "leaf", id: "p1", pagePath: "doc.pdf" },
    focusedPaneId: "p1",
  });
  useWorkspaceStore.setState({ workspacePath: "/ws" });
  usePanePdfLinkStore.setState({
    links: new Map(),
    lastSyncedPage: null,
    pendingPdfSync: new Map(),
    pendingEditorSync: new Map(),
  });
  pdfPaneRef._resetForTesting();
  resetEditorViewRef();
  resetMarkerCache();
  mockGoToPage.mockClear();
  mockReady = true;
  return cleanup;
});

describe("PdfViewerPane", () => {
  it("renders PdfViewer with absolute filePath and paneId", () => {
    const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
    expect(getByTestId("pdf-viewer-/ws/doc.pdf-p1")).toBeTruthy();
  });

  it("does not prepend workspacePath for absolute pagePath", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "/external/dir/doc.pdf" },
      focusedPaneId: "p1",
    });
    const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
    expect(getByTestId("pdf-viewer-/external/dir/doc.pdf-p1")).toBeTruthy();
  });

  it("shows empty state when pagePath is null", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: null },
      focusedPaneId: "p1",
    });
    const { getByTestId, queryByTestId } = render(<PdfViewerPane paneId="p1" />);
    expect(getByTestId("pane-empty-state")).toBeTruthy();
    expect(queryByTestId(/^pdf-viewer-\/ws/)).toBeNull();
  });

  it("applies focus border when focused", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "doc.pdf" },
      focusedPaneId: "p1",
    });
    const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
    expect(getByTestId("pdf-viewer-pane").className).toContain("border-interactive-accent");
  });

  it("applies transparent border when not focused", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "doc.pdf" },
      focusedPaneId: "other",
    });
    const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
    expect(getByTestId("pdf-viewer-pane").className).toContain("border-transparent");
  });

  it("registers a goToPage callback in pdfPaneRef under its paneId", () => {
    render(<PdfViewerPane paneId="p1" />);
    expect(pdfPaneRef.getPdfGoToPage("p1")).toBeTypeOf("function");
  });

  it("unregisters the goToPage callback on unmount", () => {
    const { unmount } = render(<PdfViewerPane paneId="p1" />);
    expect(pdfPaneRef.getPdfGoToPage("p1")).toBeTypeOf("function");
    unmount();
    expect(pdfPaneRef.getPdfGoToPage("p1")).toBeNull();
  });

  it("wires onPageCount to call setPageCount on the store", () => {
    const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
    fireEvent.click(getByTestId("fire-page-count"));
    expect(usePanePdfLinkStore.getState().pageCount.get("p1")).toBe(10);
  });

  describe("reverse sync on page change", () => {
    it("scrolls the linked editor to markers[pageIndex] when the PDF page changes", () => {
      const doc = "<!-- Page 1 -->\nintro\n<!-- Page 2 -->\nbody\n<!-- Page 3 -->\nend";
      const thirdMarkerOffset = doc.indexOf("<!-- Page 3 -->");
      const view = makeFakeEditorView(doc);
      registerPaneView("ed1", view);
      usePanePdfLinkStore.getState().linkPanes("p1", "ed1");

      const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
      fireEvent.click(getByTestId("fire-page-change"));

      expect(view.dispatch).toHaveBeenCalledTimes(1);
      const tx = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(tx.selection.head).toBe(thirdMarkerOffset);
    });

    it("is a no-op when the PDF pane is not linked", () => {
      const view = makeFakeEditorView("<!-- Page 1 -->\nx");
      registerPaneView("ed1", view);
      // No linkPanes call.

      const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
      fireEvent.click(getByTestId("fire-page-change"));

      expect(view.dispatch).not.toHaveBeenCalled();
    });

    it("skips reverse sync when page change was driven by forward sync", () => {
      const doc = "<!-- Page 1 -->\nintro\n<!-- Page 2 -->\nbody\n<!-- Page 3 -->\nend";
      const view = makeFakeEditorView(doc);
      registerPaneView("ed1", view);
      usePanePdfLinkStore.getState().linkPanes("p1", "ed1");

      // Mark the PDF pane as being driven by forward sync BEFORE the page change.
      pdfPaneRef.markForwardSync("p1");

      const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
      fireEvent.click(getByTestId("fire-page-change"));

      // Reverse sync should be suppressed -- view.dispatch NOT called.
      expect(view.dispatch).not.toHaveBeenCalled();
      // But currentPage should still be updated in the store.
      expect(usePanePdfLinkStore.getState().currentPage.get("p1")).toBe(2);
    });

    it("performs reverse sync normally after forward-sync flag is consumed", () => {
      const doc = "<!-- Page 1 -->\nintro\n<!-- Page 2 -->\nbody\n<!-- Page 3 -->\nend";
      const view = makeFakeEditorView(doc);
      registerPaneView("ed1", view);
      usePanePdfLinkStore.getState().linkPanes("p1", "ed1");

      // First click consumes the forward-sync flag.
      pdfPaneRef.markForwardSync("p1");
      const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
      fireEvent.click(getByTestId("fire-page-change"));
      expect(view.dispatch).not.toHaveBeenCalled();

      // Second click with no flag: reverse sync fires normally.
      fireEvent.click(getByTestId("fire-page-change"));
      expect(view.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  describe("pending initial PDF sync", () => {
    it("calls goToPage with pending page index when PdfViewer registers", () => {
      usePanePdfLinkStore.getState().setPendingPdfSync("p1", 5);
      render(<PdfViewerPane paneId="p1" />);
      expect(mockGoToPage).toHaveBeenCalledWith(5);
    });

    it("consumes the pending entry so it does not fire again", () => {
      usePanePdfLinkStore.getState().setPendingPdfSync("p1", 5);
      render(<PdfViewerPane paneId="p1" />);
      expect(usePanePdfLinkStore.getState().pendingPdfSync.has("p1")).toBe(false);
    });

    it("skips goToPage when pending page is 0 (already the default)", () => {
      usePanePdfLinkStore.getState().setPendingPdfSync("p1", 0);
      render(<PdfViewerPane paneId="p1" />);
      expect(mockGoToPage).not.toHaveBeenCalled();
    });

    it("marks forward sync to suppress the reverse-sync echo", () => {
      usePanePdfLinkStore.getState().setPendingPdfSync("p1", 3);
      render(<PdfViewerPane paneId="p1" />);
      // The forward-sync flag should have been set (and not yet cleared by the 500ms timer)
      expect(pdfPaneRef.consumeForwardSync("p1")).toBe(true);
    });

    it("does not call goToPage when there is no pending sync", () => {
      render(<PdfViewerPane paneId="p1" />);
      expect(mockGoToPage).not.toHaveBeenCalled();
    });

    describe("readiness gating (Finding 2)", () => {
      it("does NOT consume pending sync on a not-ready registration", () => {
        mockReady = false;
        usePanePdfLinkStore.getState().setPendingPdfSync("p1", 5);
        render(<PdfViewerPane paneId="p1" />);
        // The stale (pdfInfo=null) closure must not be invoked...
        expect(mockGoToPage).not.toHaveBeenCalled();
        // ...and the pending sync must still be available for the ready closure.
        expect(usePanePdfLinkStore.getState().pendingPdfSync.get("p1")).toBe(5);
      });

      it("consumes + fires pending sync once a ready registration arrives", () => {
        mockReady = false;
        usePanePdfLinkStore.getState().setPendingPdfSync("p1", 5);
        const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
        expect(mockGoToPage).not.toHaveBeenCalled();

        // Second registration with ready=true (pdfInfo now set).
        fireEvent.click(getByTestId("register-ready"));
        expect(mockGoToPage).toHaveBeenCalledWith(5);
        expect(usePanePdfLinkStore.getState().pendingPdfSync.has("p1")).toBe(false);
      });

      it("does NOT set the forward-sync flag on a not-ready registration", () => {
        mockReady = false;
        usePanePdfLinkStore.getState().setPendingPdfSync("p1", 3);
        render(<PdfViewerPane paneId="p1" />);
        expect(pdfPaneRef.consumeForwardSync("p1")).toBe(false);
      });

      it("sets the forward-sync flag once a ready registration arrives", () => {
        mockReady = false;
        usePanePdfLinkStore.getState().setPendingPdfSync("p1", 3);
        const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
        fireEvent.click(getByTestId("register-ready"));
        expect(pdfPaneRef.consumeForwardSync("p1")).toBe(true);
      });

      it("still registers the live goToPage closure even when not ready", () => {
        mockReady = false;
        render(<PdfViewerPane paneId="p1" />);
        // StatusBar/keyboard nav rely on the registry pointing at the closure
        // regardless of readiness.
        expect(pdfPaneRef.getPdfGoToPage("p1")).toBeTypeOf("function");
      });
    });
  });

  describe("focusedPaneId bookkeeping", () => {
    it("handleFocus calls setFocusedPane so getCurrentEditorView does not return a stale view", () => {
      // Simulate a prior editor pane having focus at the module level
      const staleView = makeFakeEditorView("stale doc");
      registerPaneView("editor1", staleView);
      setFocusedPane("editor1");
      expect(getCurrentEditorView()).toBe(staleView);

      // Render the PDF pane and simulate a click (mousedown fires handleFocus)
      const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
      fireEvent.mouseDown(getByTestId("pdf-viewer-pane"));

      // After clicking the PDF pane, focusedPaneId should be "p1" (a PDF pane with
      // no registered EditorView), so getCurrentEditorView should return null --
      // NOT the stale editor's view.
      expect(getCurrentEditorView()).toBeNull();
    });

    it("syncs module-level focusedPaneId when isFocused becomes true via store", () => {
      // Start with another pane focused
      const staleView = makeFakeEditorView("stale doc");
      registerPaneView("editor1", staleView);
      setFocusedPane("editor1");

      // PDF pane not focused initially
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "doc.pdf" },
        focusedPaneId: "editor1",
      });
      render(<PdfViewerPane paneId="p1" />);
      expect(getCurrentEditorView()).toBe(staleView);

      // Programmatically focus the PDF pane via store (e.g., closing the other pane)
      act(() => {
        usePaneStore.setState({ focusedPaneId: "p1" });
      });

      // The effect should call setFocusedPane("p1"), clearing the stale pointer
      expect(getCurrentEditorView()).toBeNull();
    });
  });
});
