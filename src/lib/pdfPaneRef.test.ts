import { describe, it, expect, beforeEach } from "vitest";
import {
  registerPdfGoToPage,
  getPdfGoToPage,
  unregisterPdfGoToPage,
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
});
