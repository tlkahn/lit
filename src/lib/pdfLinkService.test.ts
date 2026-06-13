import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPdfLinkService } from "./pdfLinkService";

// openUrl is globally mocked in setup.ts; import to inspect calls
import { openUrl } from "@tauri-apps/plugin-opener";

describe("createPdfLinkService", () => {
  let goToPage: ReturnType<typeof vi.fn>;
  let getCurrentPage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    goToPage = vi.fn();
    getCurrentPage = vi.fn(() => 0);
    vi.mocked(openUrl).mockClear();
  });

  function makeSvc(pagesCount = 10) {
    return createPdfLinkService({ pagesCount, getCurrentPage, goToPage });
  }

  it("pagesCount returns the given count", () => {
    const svc = makeSvc(5);
    expect(svc.pagesCount).toBe(5);
  });

  it("page getter returns getCurrentPage() + 1 (1-based)", () => {
    getCurrentPage.mockReturnValue(3);
    const svc = makeSvc();
    expect(svc.page).toBe(4);
  });

  it("page setter calls goToPage with val - 1 (0-based)", () => {
    const svc = makeSvc();
    svc.page = 5;
    expect(goToPage).toHaveBeenCalledWith(4);
  });

  it("goToPage converts 1-based to 0-based", () => {
    const svc = makeSvc();
    svc.goToPage(3);
    expect(goToPage).toHaveBeenCalledWith(2);
  });

  it("goToPage with string parses and converts", () => {
    const svc = makeSvc();
    svc.goToPage("7");
    expect(goToPage).toHaveBeenCalledWith(6);
  });

  it("goToPage ignores out-of-range values", () => {
    const svc = makeSvc(5);
    svc.goToPage(0);
    svc.goToPage(6);
    svc.goToPage(-1);
    expect(goToPage).not.toHaveBeenCalled();
  });

  it("addLinkAttributes sets href and rel on anchor", () => {
    const svc = makeSvc();
    const link = document.createElement("a");
    svc.addLinkAttributes(link, "https://example.com", true);
    expect(link.href).toBe("https://example.com/");
    expect(link.rel).toBe("noopener noreferrer nofollow");
    expect(link.target).toBe("_blank");
  });

  it("addLinkAttributes click handler calls openUrl for https", () => {
    const svc = makeSvc();
    const link = document.createElement("a");
    svc.addLinkAttributes(link, "https://example.com");
    link.click();
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
  });

  it("addLinkAttributes click handler calls openUrl for http", () => {
    const svc = makeSvc();
    const link = document.createElement("a");
    svc.addLinkAttributes(link, "http://example.com");
    link.click();
    expect(openUrl).toHaveBeenCalledWith("http://example.com");
  });

  it("addLinkAttributes click handler does NOT call openUrl for non-http", () => {
    const svc = makeSvc();
    const link = document.createElement("a");
    svc.addLinkAttributes(link, "mailto:test@test.com");
    link.click();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("executeNamedAction NextPage advances one page", () => {
    getCurrentPage.mockReturnValue(2);
    const svc = makeSvc();
    svc.executeNamedAction("NextPage");
    expect(goToPage).toHaveBeenCalledWith(3);
  });

  it("executeNamedAction PrevPage goes back one page", () => {
    getCurrentPage.mockReturnValue(2);
    const svc = makeSvc();
    svc.executeNamedAction("PrevPage");
    expect(goToPage).toHaveBeenCalledWith(1);
  });

  it("executeNamedAction FirstPage goes to page 0", () => {
    const svc = makeSvc();
    svc.executeNamedAction("FirstPage");
    expect(goToPage).toHaveBeenCalledWith(0);
  });

  it("executeNamedAction LastPage goes to pagesCount - 1", () => {
    const svc = makeSvc(10);
    svc.executeNamedAction("LastPage");
    expect(goToPage).toHaveBeenCalledWith(9);
  });

  it("rotation getter returns 0", () => {
    const svc = makeSvc();
    expect(svc.rotation).toBe(0);
  });

  it("isInPresentationMode returns false", () => {
    const svc = makeSvc();
    expect(svc.isInPresentationMode).toBe(false);
  });

  it("externalLinkEnabled returns true", () => {
    const svc = makeSvc();
    expect(svc.externalLinkEnabled).toBe(true);
  });

  it("getDestinationHash returns '#'", () => {
    const svc = makeSvc();
    expect(svc.getDestinationHash(null)).toBe("#");
  });

  it("getAnchorUrl returns '#'", () => {
    const svc = makeSvc();
    expect(svc.getAnchorUrl(null)).toBe("#");
  });

  // ---------- goToDestination ----------

  describe("goToDestination", () => {
    function makePdfDocument(overrides: {
      getDestination?: ReturnType<typeof vi.fn>;
      getPageIndex?: ReturnType<typeof vi.fn>;
    } = {}) {
      return {
        getDestination: overrides.getDestination ?? vi.fn(),
        getPageIndex: overrides.getPageIndex ?? vi.fn(),
      };
    }

    function makeSvcWithDoc(
      pdfDocument: ReturnType<typeof makePdfDocument> | null = null,
      pagesCount = 10,
    ) {
      return createPdfLinkService({
        pagesCount,
        getCurrentPage,
        goToPage,
        pdfDocument,
      });
    }

    it("resolves a named string destination and navigates", async () => {
      const pdfDocument = makePdfDocument({
        getDestination: vi.fn().mockResolvedValue([{ num: 5, gen: 0 }, "/XYZ", 0, 792, null]),
        getPageIndex: vi.fn().mockResolvedValue(4),
      });
      const svc = makeSvcWithDoc(pdfDocument);
      await svc.goToDestination("chapter2");
      expect(pdfDocument.getDestination).toHaveBeenCalledWith("chapter2");
      expect(pdfDocument.getPageIndex).toHaveBeenCalledWith({ num: 5, gen: 0 });
      expect(goToPage).toHaveBeenCalledWith(4);
    });

    it("navigates with an explicit array destination (object ref)", async () => {
      const pdfDocument = makePdfDocument({
        getPageIndex: vi.fn().mockResolvedValue(2),
      });
      const svc = makeSvcWithDoc(pdfDocument);
      await svc.goToDestination([{ num: 3, gen: 0 }, "/Fit"]);
      expect(pdfDocument.getPageIndex).toHaveBeenCalledWith({ num: 3, gen: 0 });
      expect(goToPage).toHaveBeenCalledWith(2);
    });

    it("navigates with an explicit array destination (integer ref)", async () => {
      const pdfDocument = makePdfDocument();
      const svc = makeSvcWithDoc(pdfDocument);
      await svc.goToDestination([5, "/Fit"]);
      expect(pdfDocument.getPageIndex).not.toHaveBeenCalled();
      expect(goToPage).toHaveBeenCalledWith(5);
    });

    it("logs error and does not navigate when named destination resolves to null", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const pdfDocument = makePdfDocument({
        getDestination: vi.fn().mockResolvedValue(null),
      });
      const svc = makeSvcWithDoc(pdfDocument);
      await svc.goToDestination("missing");
      expect(goToPage).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("logs error and does not navigate when getPageIndex rejects", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const pdfDocument = makePdfDocument({
        getPageIndex: vi.fn().mockRejectedValue(new Error("bad ref")),
      });
      const svc = makeSvcWithDoc(pdfDocument);
      await svc.goToDestination([{ num: 99, gen: 0 }, "/Fit"]);
      expect(goToPage).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("does not navigate when resolved page index is out of range", async () => {
      const pdfDocument = makePdfDocument({
        getPageIndex: vi.fn().mockResolvedValue(10), // pagesCount is 10, so index 10 is out of range
      });
      const svc = makeSvcWithDoc(pdfDocument, 10);
      await svc.goToDestination([{ num: 99, gen: 0 }, "/Fit"]);
      expect(goToPage).not.toHaveBeenCalled();
    });

    it("is a no-op when no pdfDocument is provided", async () => {
      const svc = makeSvcWithDoc(null);
      await svc.goToDestination("anything");
      expect(goToPage).not.toHaveBeenCalled();
    });

    it("navigates to page 0 (first page) correctly", async () => {
      const pdfDocument = makePdfDocument({
        getPageIndex: vi.fn().mockResolvedValue(0),
      });
      const svc = makeSvcWithDoc(pdfDocument);
      await svc.goToDestination([{ num: 1, gen: 0 }, "/Fit"]);
      expect(goToPage).toHaveBeenCalledWith(0);
    });
  });
});
