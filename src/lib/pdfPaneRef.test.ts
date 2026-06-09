import { describe, it, expect, beforeEach } from "vitest";
import {
  registerPdfGoToPage,
  getPdfGoToPage,
  unregisterPdfGoToPage,
  registerPdfCurrentPage,
  getPdfCurrentPage,
  unregisterPdfCurrentPage,
  markForwardSync,
  consumeForwardSync,
  clearForwardSync,
  _resetForTesting,
} from "./pdfPaneRef";

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
});
