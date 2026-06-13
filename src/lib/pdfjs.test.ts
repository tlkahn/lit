import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pdfjs-dist before any imports that use it.
// The factory must provide a mutable GlobalWorkerOptions object so
// the module-under-test can assign workerSrc at import time.
const mockGlobalWorkerOptions: { workerSrc: string } = { workerSrc: "" };
const mockGetDocument = vi.fn();

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: mockGlobalWorkerOptions,
  getDocument: mockGetDocument,
}));

beforeEach(() => {
  mockGlobalWorkerOptions.workerSrc = "";
  mockGetDocument.mockReset();
});

describe("pdfjs setup module", () => {
  it("sets GlobalWorkerOptions.workerSrc to a local worker URL on import", async () => {
    // Force re-evaluation of the module so the side-effect runs against fresh mock state.
    vi.resetModules();
    // Re-apply the mock after resetModules (resetModules clears it).
    vi.doMock("pdfjs-dist", () => ({
      GlobalWorkerOptions: mockGlobalWorkerOptions,
      getDocument: mockGetDocument,
    }));
    await import("./pdfjs");
    expect(mockGlobalWorkerOptions.workerSrc).toContain("pdf.worker");
  });

  it("exports CMAP_URL pointing to /pdfjs/cmaps/", async () => {
    const mod = await import("./pdfjs");
    expect(mod.CMAP_URL).toBe("/pdfjs/cmaps/");
  });

  it("exports CMAP_PACKED as true", async () => {
    const mod = await import("./pdfjs");
    expect(mod.CMAP_PACKED).toBe(true);
  });

  it("exports STANDARD_FONT_DATA_URL pointing to /pdfjs/standard_fonts/", async () => {
    const mod = await import("./pdfjs");
    expect(mod.STANDARD_FONT_DATA_URL).toBe("/pdfjs/standard_fonts/");
  });

  it("loadDocument passes cMapUrl, cMapPacked, and standardFontDataUrl to getDocument", async () => {
    const mockProxy = { numPages: 5 };
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(mockProxy) });

    const { loadDocument } = await import("./pdfjs");
    const result = await loadDocument("https://example.com/test.pdf");

    expect(mockGetDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/test.pdf",
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
      }),
    );
    expect(result).toBe(mockProxy);
  });

  it("loadDocument handles ArrayBuffer input via data parameter", async () => {
    const mockProxy = { numPages: 1 };
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(mockProxy) });

    const { loadDocument } = await import("./pdfjs");
    const buffer = new ArrayBuffer(10);
    const result = await loadDocument(buffer);

    expect(mockGetDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.any(Uint8Array),
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
      }),
    );
    // url should not be set when passing ArrayBuffer
    const callArg = mockGetDocument.mock.calls[0]![0];
    expect(callArg.url).toBeUndefined();
    expect(result).toBe(mockProxy);
  });

  it("re-exports pdfjsLib for direct access", async () => {
    const mod = await import("./pdfjs");
    expect(mod.pdfjsLib).toBeDefined();
    expect(mod.pdfjsLib.getDocument).toBe(mockGetDocument);
  });
});
