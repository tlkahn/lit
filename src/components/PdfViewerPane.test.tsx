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

vi.mock("./PdfViewer", () => ({
  PdfViewer: ({
    filePath,
    paneId,
    initialPage,
    registerGoToPage,
    onPageChange,
    onPageCount,
  }: {
    filePath: string;
    paneId: string;
    initialPage?: number;
    registerGoToPage?: (fn: (i: number) => void) => void;
    onPageChange?: (i: number) => void;
    onPageCount?: (count: number) => void;
  }) => {
    useEffect(() => {
      registerGoToPage?.(mockGoToPage);
    }, [registerGoToPage]);
    return (
      <div data-testid={`pdf-viewer-${filePath}-${paneId}`} data-initial-page={initialPage}>
        <button data-testid="fire-page-change" onClick={() => onPageChange?.(2)} />
        <button data-testid="fire-page-count" onClick={() => onPageCount?.(10)} />
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
    it("passes pending page index as initialPage to PdfViewer", () => {
      usePanePdfLinkStore.getState().setPendingPdfSync("p1", 5);
      const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
      expect(getByTestId("pdf-viewer-/ws/doc.pdf-p1").getAttribute("data-initial-page")).toBe("5");
    });

    it("consumes the pending entry so it does not fire again", () => {
      usePanePdfLinkStore.getState().setPendingPdfSync("p1", 5);
      render(<PdfViewerPane paneId="p1" />);
      expect(usePanePdfLinkStore.getState().pendingPdfSync.has("p1")).toBe(false);
    });

    it("passes initialPage 0 when pending page is 0", () => {
      usePanePdfLinkStore.getState().setPendingPdfSync("p1", 0);
      const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
      expect(getByTestId("pdf-viewer-/ws/doc.pdf-p1").getAttribute("data-initial-page")).toBe("0");
      expect(mockGoToPage).not.toHaveBeenCalled();
    });

    it("marks forward sync to suppress the reverse-sync echo", () => {
      usePanePdfLinkStore.getState().setPendingPdfSync("p1", 3);
      render(<PdfViewerPane paneId="p1" />);
      expect(pdfPaneRef.consumeForwardSync("p1")).toBe(true);
    });

    it("passes initialPage 0 when there is no pending sync", () => {
      const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
      expect(getByTestId("pdf-viewer-/ws/doc.pdf-p1").getAttribute("data-initial-page")).toBe("0");
    });

    it("never calls goToPage imperatively from PdfViewerPane", () => {
      usePanePdfLinkStore.getState().setPendingPdfSync("p1", 5);
      render(<PdfViewerPane paneId="p1" />);
      expect(mockGoToPage).not.toHaveBeenCalled();
    });

    it("still registers the goToPage callback in pdfPaneRef", () => {
      render(<PdfViewerPane paneId="p1" />);
      expect(pdfPaneRef.getPdfGoToPage("p1")).toBeTypeOf("function");
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
