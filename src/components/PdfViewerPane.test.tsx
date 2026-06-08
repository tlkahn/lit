import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import { Text } from "@codemirror/state";
import { usePaneStore } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import { usePdfCacheProgressStore } from "../stores/pdfCacheProgress";
import { mockListen, emitMockEvent } from "../test/tauri-mock";
import * as pdfPaneRef from "../lib/pdfPaneRef";
import {
  registerPaneView,
  _resetForTesting as resetEditorViewRef,
} from "../lib/editorViewRef";
import { _resetMarkerCacheForTesting as resetMarkerCache } from "../lib/pageMarkers";

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
  usePanePdfLinkStore.setState({ links: new Map(), lastSyncedPage: null });
  usePdfCacheProgressStore.setState({ progress: new Map() });
  pdfPaneRef._resetForTesting();
  resetEditorViewRef();
  resetMarkerCache();
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

  describe("pdf cache progress events", () => {
    it("updates the progress store on an event whose slot ends with this paneId", () => {
      mockListen();
      render(<PdfViewerPane paneId="p1" />);

      emitMockEvent("lit:pdf-cache-progress", {
        slot: "main:p1",
        current: 3,
        total: 20,
        done: false,
      });

      expect(usePdfCacheProgressStore.getState().progress.get("main:p1")).toEqual({
        current: 3,
        total: 20,
        done: false,
      });
    });

    it("clears the store entry when a done event arrives", () => {
      mockListen();
      render(<PdfViewerPane paneId="p1" />);

      emitMockEvent("lit:pdf-cache-progress", {
        slot: "main:p1",
        current: 10,
        total: 20,
        done: false,
      });
      expect(usePdfCacheProgressStore.getState().progress.has("main:p1")).toBe(true);

      emitMockEvent("lit:pdf-cache-progress", {
        slot: "main:p1",
        current: 20,
        total: 20,
        done: true,
      });
      expect(usePdfCacheProgressStore.getState().progress.has("main:p1")).toBe(false);
    });

    it("ignores events whose slot's last segment is not this paneId", () => {
      mockListen();
      render(<PdfViewerPane paneId="p1" />);

      emitMockEvent("lit:pdf-cache-progress", {
        slot: "main:other-pane",
        current: 3,
        total: 20,
        done: false,
      });

      expect(usePdfCacheProgressStore.getState().progress.has("main:other-pane")).toBe(false);
      expect(usePdfCacheProgressStore.getState().progress.has("main:p1")).toBe(false);
    });

    it("clears any lingering progress entry for this pane on unmount", () => {
      mockListen();
      const { unmount } = render(<PdfViewerPane paneId="p1" />);

      emitMockEvent("lit:pdf-cache-progress", {
        slot: "main:p1",
        current: 5,
        total: 20,
        done: false,
      });
      expect(usePdfCacheProgressStore.getState().progress.has("main:p1")).toBe(true);

      unmount();
      expect(usePdfCacheProgressStore.getState().progress.has("main:p1")).toBe(false);
    });
  });
});
