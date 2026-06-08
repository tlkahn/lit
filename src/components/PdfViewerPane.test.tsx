import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import { usePaneStore } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import * as pdfPaneRef from "../lib/pdfPaneRef";
import {
  registerPaneView,
  _resetForTesting as resetEditorViewRef,
} from "../lib/editorViewRef";

vi.mock("./PdfViewer", () => ({
  PdfViewer: ({
    filePath,
    paneId,
    registerGoToPage,
    onPageChange,
  }: {
    filePath: string;
    paneId: string;
    registerGoToPage?: (fn: (i: number) => void) => void;
    onPageChange?: (i: number) => void;
  }) => {
    // Simulate PdfViewer publishing its internal goToPage on mount.
    useEffect(() => {
      registerGoToPage?.(() => {});
    }, [registerGoToPage]);
    // Expose a button the test can click to drive onPageChange(2).
    return (
      <div data-testid={`pdf-viewer-${filePath}-${paneId}`}>
        <button data-testid="fire-page-change" onClick={() => onPageChange?.(2)} />
      </div>
    );
  },
}));

import { PdfViewerPane } from "./PdfViewerPane";

/** Fake EditorView with a real doc string so parsePageMarkers can scan it. */
function makeFakeEditorView(doc: string): EditorView {
  return {
    state: {
      doc: {
        length: doc.length,
        toString: () => doc,
      },
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
  usePanePdfLinkStore.setState({ links: new Map(), lastSyncedPage: null });
  pdfPaneRef._resetForTesting();
  resetEditorViewRef();
  return cleanup;
});

describe("PdfViewerPane", () => {
  it("renders PdfViewer with absolute filePath and paneId", () => {
    const { getByTestId } = render(<PdfViewerPane paneId="p1" />);
    expect(getByTestId("pdf-viewer-/ws/doc.pdf-p1")).toBeTruthy();
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
  });
});
