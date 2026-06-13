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
});
