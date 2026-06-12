import { describe, it, expect, beforeEach } from "vitest";
import {
  registerPdfGoToPage,
  getPdfGoToPage,
  unregisterPdfGoToPage,
  registerPdfCurrentPage,
  getPdfCurrentPage,
  unregisterPdfCurrentPage,
  registerPdfZoomHandlers,
  unregisterPdfZoomHandlers,
  getPdfZoomHandlers,
  getActivePdfPaneId,
  markForwardSync,
  consumeForwardSync,
  clearForwardSync,
  _resetForTesting,
} from "./pdfPaneRef";
import { usePaneStore } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { usePanePdfLinkStore } from "../stores/panePdfLink";

describe("pdfPaneRef", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("registerPdfGoToPage stores and getPdfGoToPage retrieves", () => {
    const fn = (i: number) => i;
    registerPdfGoToPage("p1", fn);
    expect(getPdfGoToPage("p1")).toBe(fn);
    expect(getPdfGoToPage("unknown")).toBeNull();
  });

  it("unregisterPdfGoToPage removes the entry", () => {
    registerPdfGoToPage("p1", () => {});
    unregisterPdfGoToPage("p1");
    expect(getPdfGoToPage("p1")).toBeNull();
  });

  it("_resetForTesting clears the map", () => {
    registerPdfGoToPage("p1", () => {});
    registerPdfGoToPage("p2", () => {});
    _resetForTesting();
    expect(getPdfGoToPage("p1")).toBeNull();
    expect(getPdfGoToPage("p2")).toBeNull();
  });

  describe("currentPage registry", () => {
    it("registerPdfCurrentPage stores and getPdfCurrentPage retrieves the value", () => {
      registerPdfCurrentPage("p1", () => 7);
      expect(getPdfCurrentPage("p1")).toBe(7);
    });

    it("getPdfCurrentPage returns null for an unknown pane", () => {
      expect(getPdfCurrentPage("unknown")).toBeNull();
    });

    it("unregisterPdfCurrentPage removes the entry", () => {
      registerPdfCurrentPage("p1", () => 7);
      unregisterPdfCurrentPage("p1");
      expect(getPdfCurrentPage("p1")).toBeNull();
    });

    it("_resetForTesting clears the currentPage map", () => {
      registerPdfCurrentPage("p1", () => 1);
      registerPdfCurrentPage("p2", () => 2);
      _resetForTesting();
      expect(getPdfCurrentPage("p1")).toBeNull();
      expect(getPdfCurrentPage("p2")).toBeNull();
    });
  });

  describe("forward-sync flag", () => {
    it("consumeForwardSync returns true after markForwardSync, false on second call", () => {
      markForwardSync("p1");
      expect(consumeForwardSync("p1")).toBe(true);
      expect(consumeForwardSync("p1")).toBe(false);
    });

    it("consumeForwardSync returns false when nothing was marked", () => {
      expect(consumeForwardSync("p1")).toBe(false);
    });

    it("clearForwardSync removes the mark when the token matches", () => {
      const token = markForwardSync("p1");
      clearForwardSync("p1", token);
      expect(consumeForwardSync("p1")).toBe(false);
    });

    it("clearForwardSync with a stale token does not clear a newer mark", () => {
      const t1 = markForwardSync("p1");
      const t2 = markForwardSync("p1");
      expect(t2).not.toBe(t1);
      // A stale safety-net timeout fires with the old token; it must be a no-op.
      clearForwardSync("p1", t1);
      // The newer navigation's flag survives.
      expect(consumeForwardSync("p1")).toBe(true);
    });

    it("_resetForTesting clears forward-sync flags", () => {
      markForwardSync("p1");
      markForwardSync("p2");
      _resetForTesting();
      expect(consumeForwardSync("p1")).toBe(false);
      expect(consumeForwardSync("p2")).toBe(false);
    });
  });

  describe("zoom handler registry", () => {
    it("registerPdfZoomHandlers stores handlers retrievable by getPdfZoomHandlers", () => {
      const handlers = { zoomIn: () => {}, zoomOut: () => {}, zoomReset: () => {} };
      registerPdfZoomHandlers("p1", handlers);
      expect(getPdfZoomHandlers("p1")).toBe(handlers);
      expect(getPdfZoomHandlers("unknown")).toBeNull();
    });

    it("unregisterPdfZoomHandlers removes the handlers", () => {
      const handlers = { zoomIn: () => {}, zoomOut: () => {}, zoomReset: () => {} };
      registerPdfZoomHandlers("p1", handlers);
      unregisterPdfZoomHandlers("p1");
      expect(getPdfZoomHandlers("p1")).toBeNull();
    });

    it("_resetForTesting clears zoom handler map", () => {
      registerPdfZoomHandlers("p1", { zoomIn: () => {}, zoomOut: () => {}, zoomReset: () => {} });
      registerPdfZoomHandlers("p2", { zoomIn: () => {}, zoomOut: () => {}, zoomReset: () => {} });
      _resetForTesting();
      expect(getPdfZoomHandlers("p1")).toBeNull();
      expect(getPdfZoomHandlers("p2")).toBeNull();
    });
  });

  describe("getActivePdfPaneId", () => {
    beforeEach(() => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pdf1", pagePath: "doc.pdf" },
        focusedPaneId: "pdf1",
      });
      useWorkspaceStore.setState({
        pages: [{ relative_path: "doc.pdf", file_type: "pdf", title: "doc" }],
      } as never);
      usePanePdfLinkStore.setState({
        links: new Map(),
        lastSyncedPage: null,
        pendingPdfSync: new Map(),
        pendingEditorSync: new Map(),
      });
    });

    it("returns focused pane when it is a PDF", () => {
      expect(getActivePdfPaneId()).toBe("pdf1");
    });

    it("returns linked pane when focused is not PDF", () => {
      usePaneStore.setState({
        root: {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [
            { type: "leaf", id: "ed1", pagePath: "note.md" },
            { type: "leaf", id: "pdf1", pagePath: "doc.pdf" },
          ],
          sizes: [50, 50],
        },
        focusedPaneId: "ed1",
      });
      useWorkspaceStore.setState({
        pages: [
          { relative_path: "note.md", file_type: "markdown", title: "note" },
          { relative_path: "doc.pdf", file_type: "pdf", title: "doc" },
        ],
      } as never);
      usePanePdfLinkStore.getState().linkPanes("pdf1", "ed1");

      expect(getActivePdfPaneId()).toBe("pdf1");
    });

    it("returns null when no PDF pane is active or linked", () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "ed1", pagePath: "note.md" },
        focusedPaneId: "ed1",
      });
      useWorkspaceStore.setState({
        pages: [{ relative_path: "note.md", file_type: "markdown", title: "note" }],
      } as never);

      expect(getActivePdfPaneId()).toBeNull();
    });
  });
});
