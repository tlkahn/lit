import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { PdfViewer } from "./PdfViewer";

// ---------------------------------------------------------------------------
// Mock pdfjs setup module (src/lib/pdfjs.ts)
// ---------------------------------------------------------------------------
const mockRender = vi.fn(() => ({
  promise: Promise.resolve(),
  cancel: vi.fn(),
}));

const mockGetViewport = vi.fn(() => ({ width: 1224, height: 1584 }));

const mockGetTextContent = vi.fn(() =>
  Promise.resolve({ items: [], styles: {}, lang: null }),
);

const mockGetAnnotations = vi.fn(() => Promise.resolve([] as object[]));

const mockPageCleanup = vi.fn(() => true);

const mockGetPage = vi.fn(() =>
  Promise.resolve({
    getViewport: mockGetViewport,
    render: mockRender,
    getTextContent: mockGetTextContent,
    getAnnotations: mockGetAnnotations,
    cleanup: mockPageCleanup,
  }),
);

const mockDestroy = vi.fn(() => Promise.resolve());

const mockDoc = {
  numPages: 3,
  getPage: mockGetPage,
  destroy: mockDestroy,
};

const mockLoadDocument = vi.fn(() => Promise.resolve(mockDoc));

const mockTextLayerRender = vi.fn(() => Promise.resolve());
const mockTextLayerCancel = vi.fn();
const MockTextLayer = vi.fn().mockImplementation(() => ({
  render: mockTextLayerRender,
  cancel: mockTextLayerCancel,
  textDivs: [],
  textContentItemsStr: [],
}));

const mockAnnotationLayerRender = vi.fn(() => Promise.resolve());
const MockAnnotationLayer = vi.fn().mockImplementation(() => ({
  render: mockAnnotationLayerRender,
  div: null,
  page: null,
  viewport: null,
  zIndex: 0,
}));

const mockSetLayerDimensions = vi.fn();

vi.mock("../lib/pdfjs", () => ({
  loadDocument: (...args: unknown[]) => (mockLoadDocument as (...a: unknown[]) => unknown)(...args),
  // TextLayer and AnnotationLayer are called with `new`, so we use a class
  // wrapper that delegates to the mock constructor at call time (after init).
  TextLayer: class {
    _inst: unknown;
    constructor(...args: unknown[]) {
      this._inst = (MockTextLayer as (...a: unknown[]) => unknown)(...args);
      return this._inst as typeof this;
    }
  },
  AnnotationLayer: class {
    _inst: unknown;
    constructor(...args: unknown[]) {
      this._inst = (MockAnnotationLayer as (...a: unknown[]) => unknown)(...args);
      return this._inst as typeof this;
    }
  },
  setLayerDimensions: (...args: unknown[]) => (mockSetLayerDimensions as (...a: unknown[]) => unknown)(...args),
}));

// ---------------------------------------------------------------------------
// Canvas mock — jsdom has no real canvas
// ---------------------------------------------------------------------------
const mockCanvasContext = {};

beforeEach(() => {
  Object.defineProperty(window, "devicePixelRatio", {
    writable: true,
    value: 1,
  });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCanvasContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  mockLoadDocument.mockReset();
  mockLoadDocument.mockImplementation(() => Promise.resolve(mockDoc));
  mockGetPage.mockReset();
  mockPageCleanup.mockReset();
  mockPageCleanup.mockReturnValue(true);
  mockGetPage.mockImplementation(() =>
    Promise.resolve({
      getViewport: mockGetViewport,
      render: mockRender,
      getTextContent: mockGetTextContent,
      getAnnotations: mockGetAnnotations,
      cleanup: mockPageCleanup,
    }),
  );
  mockGetViewport.mockReset();
  mockGetViewport.mockReturnValue({ width: 1224, height: 1584 });
  mockRender.mockReset();
  mockRender.mockReturnValue({
    promise: Promise.resolve(),
    cancel: vi.fn(),
  });
  mockDestroy.mockReset();
  mockDestroy.mockReturnValue(Promise.resolve());
  mockGetTextContent.mockReset();
  mockGetTextContent.mockReturnValue(Promise.resolve({ items: [], styles: {}, lang: null }));
  mockGetAnnotations.mockReset();
  mockGetAnnotations.mockReturnValue(Promise.resolve([] as object[]));
  MockTextLayer.mockClear();
  mockTextLayerRender.mockReset();
  mockTextLayerRender.mockReturnValue(Promise.resolve());
  mockTextLayerCancel.mockReset();
  MockAnnotationLayer.mockClear();
  mockAnnotationLayerRender.mockReset();
  mockAnnotationLayerRender.mockReturnValue(Promise.resolve());
  mockSetLayerDimensions.mockReset();
});

describe("PdfViewer", () => {
  it("renders a canvas element", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });
  });

  it("calls onPageCount with the page count on initial load", async () => {
    const onPageCount = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageCount={onPageCount} />);

    await waitFor(() => {
      expect(onPageCount).toHaveBeenCalledWith(3);
    });
    expect(onPageCount).toHaveBeenCalledTimes(1);
  });

  it("calls loadDocument on mount and destroy on unmount", async () => {
    const { unmount } = render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });

    expect(mockLoadDocument).toHaveBeenCalledWith(
      expect.stringContaining("asset://localhost/"),
    );

    unmount();

    await waitFor(() => {
      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  it("shows loading state initially", () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    expect(screen.getByTestId("pdf-loading")).toBeInTheDocument();
  });

  it("shows error state on failure", async () => {
    mockLoadDocument.mockRejectedValue(new Error("Failed to open PDF"));

    render(<PdfViewer filePath="/bad/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      const error = screen.getByTestId("pdf-error");
      expect(error).toBeInTheDocument();
      expect(error.textContent).toContain("Failed to open PDF");
    });
  });

  it("scales canvas by devicePixelRatio and sets CSS width accordingly", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2 });
    mockGetViewport.mockReturnValue({ width: 2448, height: 3168 });
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      const canvas = screen.getByTestId("pdf-page-canvas") as HTMLCanvasElement;
      expect(canvas.width).toBe(2448);
      expect(canvas.style.width).toBe("1224px");
    });
  });

  it("sets canvas width to viewport.width at devicePixelRatio=1", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      const canvas = screen.getByTestId("pdf-page-canvas") as HTMLCanvasElement;
      expect(canvas.width).toBe(1224);
      expect(canvas.style.width).toBe("1224px");
    });
  });

  it("navigates back without error (pdf.js handles page caching internally)", async () => {
    const onPageChange = vi.fn();
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    goToPage!(1);
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    goToPage!(0);
    await waitFor(() => {
      const calls = onPageChange.mock.calls.map((c) => c[0]);
      expect(calls.filter((c: number) => c === 0).length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows loading state immediately when filePath changes (no stale page visible)", async () => {
    const { rerender } = render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // Set up a deferred loadDocument so the new file hangs
    let resolveLoad!: (v: typeof mockDoc) => void;
    const deferredLoad = new Promise<typeof mockDoc>((r) => { resolveLoad = r; });
    mockLoadDocument.mockReturnValue(deferredLoad);

    rerender(<PdfViewer filePath="/test/other.pdf" paneId="pane-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-loading")).toBeInTheDocument();
    });

    // Clean up: resolve so the effect settles
    resolveLoad(mockDoc);
  });

  it("shows spinner during initial loading", () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    const loading = screen.getByTestId("pdf-loading");
    expect(loading.querySelector("svg")).toBeInTheDocument();
    expect(loading.textContent).toContain("Loading PDF…");
  });

  it("shows spinner overlay during page navigation", async () => {
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    // Make render deferred so pageLoading stays true
    let resolveRender!: () => void;
    const deferred = new Promise<void>((r) => { resolveRender = r; });
    mockRender.mockReturnValue({
      promise: deferred,
      cancel: vi.fn(),
    });

    goToPage!(1);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-loading")).toBeInTheDocument();
    });
    expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();

    resolveRender();

    await waitFor(() => {
      expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
    });
  });

  it("hides spinner overlay when page render fails", async () => {
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    mockRender.mockReturnValue({
      promise: Promise.reject(new Error("render failed")),
      cancel: vi.fn(),
    });

    goToPage!(1);

    await waitFor(() => {
      // After the fix, render failures during navigation are non-fatal:
      // the viewer stays mounted and no pdf-error is shown.
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("pdf-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
  });

  it("a getPage rejection during navigation leaves the viewer mounted, not pdf-error", async () => {
    let goToPage: ((i: number) => void) | null = null;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    // Make getPage reject for the next navigation
    mockGetPage.mockRejectedValueOnce(new Error("page unavailable"));

    await act(async () => { goToPage!(1); });

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("pdf-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[PdfViewer]"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("a render rejection during navigation leaves the viewer mounted, not pdf-error", async () => {
    let goToPage: ((i: number) => void) | null = null;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    mockRender.mockReturnValue({
      promise: Promise.reject(new Error("render failed")),
      cancel: vi.fn(),
    });

    await act(async () => { goToPage!(1); });

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("pdf-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[PdfViewer]"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("currentPageRef reverts to previous page on navigation failure", async () => {
    let goToPage: ((i: number) => void) | null = null;
    let getCurrentPage: (() => number) | null = null;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
        registerGetCurrentPage={(fn) => { getCurrentPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();
    expect(getCurrentPage).not.toBeNull();
    expect(getCurrentPage!()).toBe(0);

    // Make getPage reject
    mockGetPage.mockRejectedValueOnce(new Error("page unavailable"));

    await act(async () => { goToPage!(1); });

    // currentPageRef should revert to the previous page (0)
    await waitFor(() => {
      expect(getCurrentPage!()).toBe(0);
    });

    // Reset getPage to succeed again
    mockGetPage.mockImplementation(() =>
      Promise.resolve({
        getViewport: mockGetViewport,
        render: mockRender,
        getTextContent: mockGetTextContent,
        getAnnotations: mockGetAnnotations,
        cleanup: mockPageCleanup,
      }),
    );
    mockGetPage.mockClear();

    // Retry goToPage(1) — should NOT be blocked by same-page guard
    await act(async () => { goToPage!(1); });

    expect(mockGetPage).toHaveBeenCalledWith(2); // 1-based: page index 1 = getPage(2)
    warnSpy.mockRestore();
  });

  it("J navigates to the next page", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "j" });

    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });
    // getPage uses 1-based pages: page 0 initial = getPage(1), page 1 nav = getPage(2)
    expect(mockGetPage).toHaveBeenCalledWith(2);
  });

  it("advances two pages on a rapid double key-press without dropping one", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });

    const viewer = screen.getByTestId("pdf-viewer");
    fireEvent.keyDown(viewer, { key: "j" });
    fireEvent.keyDown(viewer, { key: "j" });

    await waitFor(() => {
      const pageChanges = onPageChange.mock.calls.map((c) => c[0]);
      expect(pageChanges).toContain(2);
    });
  });

  it("ArrowRight navigates to the next page", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "ArrowRight" });

    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });
  });

  it("K on the first page is a no-op", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });

    const getPageCallsBefore = mockGetPage.mock.calls.length;

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "k" });

    // No additional getPage calls
    await Promise.resolve();
    expect(mockGetPage.mock.calls.length).toBe(getPageCallsBefore);
  });

  it("J on the last page is a no-op", async () => {
    const onPageChange = vi.fn();
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    goToPage!(2);
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    onPageChange.mockClear();
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "j" });

    await Promise.resolve();
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("fires onPageChange(0) exactly once after the initial page renders", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(0);
    });

    const zeroCalls = onPageChange.mock.calls.filter((c) => c[0] === 0);
    expect(zeroCalls).toHaveLength(1);
  });

  it("calls onPageChange when the page changes", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "j" });

    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });
  });

  it("ignores a `page` prop and does not navigate from it (imperative-only navigation)", async () => {
    render(
      <PdfViewer filePath="/test/doc.pdf" paneId="pane-1" {...({ page: 2 } as unknown as Record<string, never>)} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });

    await Promise.resolve();

    // getPage should only have been called with page 1 (0-based index 0 = 1-based page 1)
    const calledWith2Based = mockGetPage.mock.calls.some((c: unknown[]) => c[0] === 3);
    expect(calledWith2Based).toBe(false);
  });

  it("goToPage does not fire onPageChange for same-page navigation", async () => {
    const onPageChange = vi.fn();
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    onPageChange.mockClear();
    goToPage!(0);

    await waitFor(() => {
      expect(onPageChange).not.toHaveBeenCalled();
    });
  });

  it("does not revert to an earlier page when a slow render resolves after a newer navigation", async () => {
    const onPageChange = vi.fn();
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    // Navigate to page 2 first (fast)
    await act(async () => { goToPage!(2); });
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    // Now set up renders: first call slow, second call fast
    let resolveSlowRender!: () => void;
    const slowRenderPromise = new Promise<void>((r) => { resolveSlowRender = r; });
    let renderCallIdx = 0;
    (mockGetPage as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({
        getViewport: mockGetViewport,
        getTextContent: mockGetTextContent,
        getAnnotations: mockGetAnnotations,
        cleanup: mockPageCleanup,
        render: () => {
          renderCallIdx++;
          if (renderCallIdx === 1) {
            return { promise: slowRenderPromise, cancel: vi.fn() };
          }
          return { promise: Promise.resolve(), cancel: vi.fn() };
        },
      }),
    );

    onPageChange.mockClear();

    // Call goToPage(1) — its render will be slow
    // Call goToPage(0) — its render will be fast and should win
    await act(async () => {
      goToPage!(1);
      // Let microtask queue process so goToPage(1) starts its async work
      await Promise.resolve();
      await Promise.resolve();
      goToPage!(0);
      // Let goToPage(0)'s async work proceed
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(0);
    });

    await act(async () => { resolveSlowRender(); });
    await Promise.resolve();

    const pageChanges = onPageChange.mock.calls.map((c) => c[0]);
    expect(pageChanges[pageChanges.length - 1]).toBe(0);
    expect(onPageChange).not.toHaveBeenCalledWith(1);
  });

  it("keeps spinner while a superseding navigation is still rendering after a stale render resolves", async () => {
    let goToPage: ((i: number) => void) | null = null;
    const onPageChange = vi.fn();
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    let resolveA!: () => void;
    let resolveB!: () => void;
    const renderA = new Promise<void>((r) => { resolveA = r; });
    const renderB = new Promise<void>((r) => { resolveB = r; });
    let renderCallCount = 0;
    (mockGetPage as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({
        getViewport: mockGetViewport,
        getTextContent: mockGetTextContent,
        getAnnotations: mockGetAnnotations,
        cleanup: mockPageCleanup,
        render: () => {
          renderCallCount++;
          if (renderCallCount === 1) {
            return { promise: renderA, cancel: vi.fn() };
          }
          return { promise: renderB, cancel: vi.fn() };
        },
      }),
    );

    await act(async () => {
      goToPage!(1);
      await Promise.resolve();
      await Promise.resolve();
      goToPage!(2);
    });

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-loading")).toBeInTheDocument();
    });

    // Resolve stale render A
    await act(async () => {
      resolveA();
      await renderA;
    });

    // Spinner should still be visible because render B is still pending
    expect(screen.queryByTestId("pdf-page-loading")).toBeInTheDocument();

    // Resolve current render B
    await act(async () => {
      resolveB();
      await renderB;
    });

    await waitFor(() => {
      expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(2);
    });
  });

  it("does not show the spinner before the grace period elapses", async () => {
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    let resolveRender!: () => void;
    const deferred = new Promise<void>((r) => { resolveRender = r; });
    mockRender.mockReturnValue({
      promise: deferred,
      cancel: vi.fn(),
    });

    await act(async () => {
      goToPage!(1);
    });

    // Transition started, but the grace timer has not fired yet.
    expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-loading")).toBeInTheDocument();
    });

    resolveRender();
  });

  it("renders the spinner overlay outside the scroll container, pinned to the pane", async () => {
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    let resolveRender!: () => void;
    const deferred = new Promise<void>((r) => { resolveRender = r; });
    mockRender.mockReturnValue({
      promise: deferred,
      cancel: vi.fn(),
    });

    goToPage!(1);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-loading")).toBeInTheDocument();
    });

    const overlay = screen.getByTestId("pdf-page-loading");
    expect(overlay.parentElement).toBe(screen.getByTestId("pdf-viewer"));
    expect(overlay.parentElement!.className).not.toContain("overflow-auto");

    resolveRender();
  });

  it("uses 1-based page numbers for pdf.js getPage (0-based index 0 = getPage(1))", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });

    // Initial page 0 should call getPage(1)
    expect(mockGetPage).toHaveBeenCalledWith(1);
  });

  it("registerGoToPage publishes (fn, false) before doc loads and (fn, true) after", async () => {
    const registerGoToPage = vi.fn();

    // Make loadDocument deferred so we can observe the pre-load registration
    let resolveLoad!: (v: typeof mockDoc) => void;
    const deferredLoad = new Promise<typeof mockDoc>((r) => { resolveLoad = r; });
    mockLoadDocument.mockReturnValue(deferredLoad);

    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={registerGoToPage}
      />,
    );

    // Before doc loads, should register with ready=false
    await waitFor(() => {
      expect(registerGoToPage).toHaveBeenCalledWith(expect.any(Function), false);
    });

    resolveLoad(mockDoc);

    // After doc loads, should register with ready=true
    await waitFor(() => {
      expect(registerGoToPage).toHaveBeenCalledWith(expect.any(Function), true);
    });
  });

  it("registerGetCurrentPage publishes a synchronous getter", async () => {
    let getCurrentPage: (() => number) | null = null;
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGetCurrentPage={(fn) => { getCurrentPage = fn; }}
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });
    expect(getCurrentPage).not.toBeNull();
    expect(getCurrentPage!()).toBe(0);

    goToPage!(1);
    // The getter reads currentPageRef which is updated synchronously
    expect(getCurrentPage!()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Zoom tests
  // -------------------------------------------------------------------------

  it("Cmd+= zooms in one step (1.0 -> 1.1)", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    mockGetViewport.mockClear();
    mockGetPage.mockClear();

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });

    await waitFor(() => {
      // dpr=1, next step above 1.0 is 1.1, so scale = 1 * 1.1 = 1.1
      expect(mockGetViewport).toHaveBeenCalledWith({ scale: expect.closeTo(1.1, 5) });
    });
    // Re-renders the current page (page 1, 1-based)
    expect(mockGetPage).toHaveBeenCalledWith(1);
  });

  it("Cmd+- zooms out one step (1.0 -> 0.9)", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    mockGetViewport.mockClear();
    mockGetPage.mockClear();

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "-", metaKey: true });

    await waitFor(() => {
      expect(mockGetViewport).toHaveBeenCalledWith({ scale: expect.closeTo(0.9, 5) });
    });
    expect(mockGetPage).toHaveBeenCalledWith(1);
  });

  it("Cmd+0 resets zoom to 1.0", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // Zoom in first
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });
    await waitFor(() => {
      expect(mockGetViewport).toHaveBeenCalledWith({ scale: expect.closeTo(1.1, 5) });
    });

    mockGetViewport.mockClear();
    mockGetPage.mockClear();

    // Reset
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "0", metaKey: true });

    await waitFor(() => {
      expect(mockGetViewport).toHaveBeenCalledWith({ scale: expect.closeTo(1.0, 5) });
    });
  });

  it("zoom in at max step (3.0) is a no-op", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // Zoom all the way to 3.0: steps are [0.5,0.67,0.75,0.8,0.9,1.0,1.1,1.25,1.5,1.75,2.0,2.5,3.0]
    // From 1.0, need to press = 7 times: 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0
    const viewer = screen.getByTestId("pdf-viewer");
    for (let i = 0; i < 7; i++) {
      fireEvent.keyDown(viewer, { key: "=", metaKey: true });
      // Allow async re-render to complete
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    }

    await waitFor(() => {
      expect(mockGetViewport).toHaveBeenCalledWith({ scale: expect.closeTo(3.0, 5) });
    });

    mockGetPage.mockClear();

    // One more zoom in should be a no-op
    fireEvent.keyDown(viewer, { key: "=", metaKey: true });
    await act(async () => { await Promise.resolve(); });

    expect(mockGetPage).not.toHaveBeenCalled();
  });

  it("zoom out at min step (0.5) is a no-op", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // Zoom all the way down to 0.5: from 1.0, press - 5 times: 0.9, 0.8, 0.75, 0.67, 0.5
    const viewer = screen.getByTestId("pdf-viewer");
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(viewer, { key: "-", metaKey: true });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    }

    await waitFor(() => {
      expect(mockGetViewport).toHaveBeenCalledWith({ scale: expect.closeTo(0.5, 5) });
    });

    mockGetPage.mockClear();

    // One more zoom out should be a no-op
    fireEvent.keyDown(viewer, { key: "-", metaKey: true });
    await act(async () => { await Promise.resolve(); });

    expect(mockGetPage).not.toHaveBeenCalled();
  });

  it("zoom resets to 1.0 on filePath change", async () => {
    const { rerender } = render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // Zoom in
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });
    await waitFor(() => {
      expect(mockGetViewport).toHaveBeenCalledWith({ scale: expect.closeTo(1.1, 5) });
    });

    mockGetViewport.mockClear();

    // Change file
    rerender(<PdfViewer filePath="/test/other.pdf" paneId="pane-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // The initial render of the new file should use dpr * 1.0 = 1.0
    await waitFor(() => {
      expect(mockGetViewport).toHaveBeenCalledWith({ scale: expect.closeTo(1.0, 5) });
    });
    // Ensure it was NOT called with 1.1 (the zoomed scale)
    const calls = mockGetViewport.mock.calls.map((c: unknown[]) => c[0] as { scale: number });
    const hasZoomed = calls.some((c) => Math.abs(c.scale - 1.1) < 0.001);
    expect(hasZoomed).toBe(false);
  });

  it("canvas resolution is capped at MAX_CANVAS_SCALE (4.0)", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2 });
    // Use a scale-aware viewport mock so canvas backing size reflects the actual scale used
    (mockGetViewport as ReturnType<typeof vi.fn>).mockImplementation(({ scale }: { scale: number }) => ({
      width: 1224 * scale,
      height: 1584 * scale,
    }));

    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // Zoom to 3.0: effective = 2 * 3.0 = 6.0, but capped at 4.0
    // From 1.0 press = 7 times: 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0
    const viewer = screen.getByTestId("pdf-viewer");
    for (let i = 0; i < 7; i++) {
      fireEvent.keyDown(viewer, { key: "=", metaKey: true });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    }

    await waitFor(() => {
      // Should be capped at 4.0, not 6.0
      expect(mockGetViewport).toHaveBeenCalledWith({ scale: 4.0 });
    });

    // Canvas backing: viewport.width at scale=4.0 = 1224 * 4.0 = 4896
    const canvas = screen.getByTestId("pdf-page-canvas") as HTMLCanvasElement;
    expect(canvas.width).toBe(4896);

    // CSS width: viewport.width / canvasScale * zoom = 4896 / 4.0 * 3.0 = 3672
    expect(canvas.style.width).toBe("3672px");
  });

  it("Ctrl+= also zooms in (non-Mac)", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    mockGetViewport.mockClear();

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", ctrlKey: true });

    await waitFor(() => {
      expect(mockGetViewport).toHaveBeenCalledWith({ scale: expect.closeTo(1.1, 5) });
    });
  });

  it("plain = without modifier does not zoom", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    mockGetViewport.mockClear();
    mockGetPage.mockClear();

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=" });
    await act(async () => { await Promise.resolve(); });

    expect(mockGetPage).not.toHaveBeenCalled();
  });

  it("zoom re-renders the current page without firing onPageChange", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    onPageChange.mockClear();
    mockGetPage.mockClear();

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });

    await waitFor(() => {
      // It re-renders the current page (1-based page 1)
      expect(mockGetPage).toHaveBeenCalledWith(1);
    });
    // But does NOT fire onPageChange
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("Cmd++ also zooms in (plus key)", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    mockGetViewport.mockClear();

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "+", metaKey: true });

    await waitFor(() => {
      expect(mockGetViewport).toHaveBeenCalledWith({ scale: expect.closeTo(1.1, 5) });
    });
  });

  it("zoom=2.0 at dpr=1 doubles the canvas CSS width compared to zoom=1.0", async () => {
    // dpr=1 (default in beforeEach), baseWidth=612
    (mockGetViewport as ReturnType<typeof vi.fn>).mockImplementation(({ scale }: { scale: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
    }));

    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // At zoom=1.0 dpr=1: canvasScale=1, viewport.width=612, cssWidth should be 612
    const canvas = screen.getByTestId("pdf-page-canvas") as HTMLCanvasElement;
    expect(canvas.style.width).toBe("612px");

    // Zoom in 5 times from 1.0 to reach 2.0: 1.1, 1.25, 1.5, 1.75, 2.0
    const viewer = screen.getByTestId("pdf-viewer");
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(viewer, { key: "=", metaKey: true });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    // At zoom=2.0 dpr=1: canvasScale=2, viewport.width=1224, cssWidth should be 1224/2*2 = 1224
    // i.e. baseWidth * zoom = 612 * 2.0 = 1224
    await waitFor(() => {
      expect(canvas.style.width).toBe("1224px");
    });
  });

  // -------------------------------------------------------------------------
  // Text layer tests
  // -------------------------------------------------------------------------

  it("renders a text layer div", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-text-layer")).toBeInTheDocument();
    });
  });

  it("calls getTextContent and creates TextLayer on initial page render", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockGetTextContent).toHaveBeenCalled();
    });
    expect(MockTextLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        textContentSource: expect.anything(),
        container: expect.any(HTMLElement),
        viewport: expect.anything(),
      }),
    );
    expect(mockTextLayerRender).toHaveBeenCalled();
  });

  it("text layer is re-rendered on page navigation", async () => {
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    mockGetTextContent.mockClear();
    MockTextLayer.mockClear();
    mockTextLayerRender.mockClear();

    await act(async () => { goToPage!(1); });

    await waitFor(() => {
      expect(mockGetTextContent).toHaveBeenCalled();
    });
    expect(mockTextLayerRender).toHaveBeenCalled();
  });

  it("text layer is re-rendered on zoom without re-fetching text content", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    mockGetTextContent.mockClear();
    MockTextLayer.mockClear();
    mockTextLayerRender.mockClear();

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });

    await waitFor(() => {
      expect(mockTextLayerRender).toHaveBeenCalled(); // layer IS re-rendered
    });
    expect(mockGetTextContent).not.toHaveBeenCalled(); // but content is NOT re-fetched
  });

  it("text layer div has className textLayer", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      const textLayer = screen.getByTestId("pdf-text-layer");
      expect(textLayer.className).toContain("textLayer");
    });
  });

  // -------------------------------------------------------------------------
  // Layer cache on zoom tests
  // -------------------------------------------------------------------------

  it("getTextContent is called once per page across multiple zoom steps on the same page", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // Initial load called getTextContent once
    expect(mockGetTextContent).toHaveBeenCalledTimes(1);
    mockGetTextContent.mockClear();

    const viewer = screen.getByTestId("pdf-viewer");

    // Zoom in 3 times on the same page
    for (let i = 0; i < 3; i++) {
      fireEvent.keyDown(viewer, { key: "=", metaKey: true });
      await act(async () => {
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      });
    }

    // getTextContent should NOT have been called again
    expect(mockGetTextContent).not.toHaveBeenCalled();
  });

  it("getAnnotations is called once per page across multiple zoom steps on the same page", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    expect(mockGetAnnotations).toHaveBeenCalledTimes(1);
    mockGetAnnotations.mockClear();

    const viewer = screen.getByTestId("pdf-viewer");
    for (let i = 0; i < 3; i++) {
      fireEvent.keyDown(viewer, { key: "=", metaKey: true });
      await act(async () => {
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      });
    }

    expect(mockGetAnnotations).not.toHaveBeenCalled();
  });

  it("getTextContent is called fresh when navigating to a different page after zoom", async () => {
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    // Zoom on page 0 (uses cache after initial fetch)
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    mockGetTextContent.mockClear();

    // Navigate to page 1 — should fetch fresh text content
    await act(async () => { goToPage!(1); });

    await waitFor(() => {
      expect(mockGetTextContent).toHaveBeenCalledTimes(1);
    });
  });

  it("layer cache is cleared on file change — getTextContent is called for the new file", async () => {
    const { rerender } = render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // Initial load fetched text content for page 0
    expect(mockGetTextContent).toHaveBeenCalledTimes(1);
    mockGetTextContent.mockClear();

    // Change file
    rerender(<PdfViewer filePath="/test/other.pdf" paneId="pane-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // New file's page 0 should trigger a fresh getTextContent
    await waitFor(() => {
      expect(mockGetTextContent).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Canvas-first paint tests (Concern A)
  // -------------------------------------------------------------------------

  it("canvasReady does NOT await getTextContent (canvas-first paint)", async () => {
    // Make getTextContent and getAnnotations return promises that NEVER resolve
    mockGetTextContent.mockReturnValue(new Promise(() => {}));
    mockGetAnnotations.mockReturnValue(new Promise(() => {}));

    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    // Canvas should become ready even though getTextContent never resolved
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // getTextContent was called (just not awaited on the critical path)
    expect(mockGetTextContent).toHaveBeenCalled();
  });

  it("getTextContent is still called once per page and reused across zoom steps (async layer fix)", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // Wait for the async layer work to complete (getTextContent should be called once)
    await waitFor(() => {
      expect(mockGetTextContent).toHaveBeenCalledTimes(1);
    });
    mockGetTextContent.mockClear();

    const viewer = screen.getByTestId("pdf-viewer");

    // Zoom in 3 times on the same page
    for (let i = 0; i < 3; i++) {
      fireEvent.keyDown(viewer, { key: "=", metaKey: true });
      await act(async () => {
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      });
    }

    // getTextContent should NOT have been called again — cache is reused
    expect(mockGetTextContent).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Annotation layer tests
  // -------------------------------------------------------------------------

  it("renders an annotation layer div", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-annotation-layer")).toBeInTheDocument();
    });
  });

  it("calls getAnnotations on initial page render", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockGetAnnotations).toHaveBeenCalled();
    });
  });

  it("annotation layer div has className annotationLayer", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      const annotLayer = screen.getByTestId("pdf-annotation-layer");
      expect(annotLayer.className).toContain("annotationLayer");
    });
  });

  it("calls setLayerDimensions for text layer after render", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockSetLayerDimensions).toHaveBeenCalled();
    });
    // Check that at least one call was for the text layer div
    const textLayerDiv = screen.getByTestId("pdf-text-layer");
    const calls = mockSetLayerDimensions.mock.calls;
    const hasTextLayerCall = calls.some((c: unknown[]) => c[0] === textLayerDiv);
    expect(hasTextLayerCall).toBe(true);
  });

  it("page container wraps canvas and layers", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    const canvas = screen.getByTestId("pdf-page-canvas");
    const textLayer = screen.getByTestId("pdf-text-layer");
    const annotLayer = screen.getByTestId("pdf-annotation-layer");

    // All three should share the same parent (the page container)
    expect(canvas.parentElement).toBe(textLayer.parentElement);
    expect(canvas.parentElement).toBe(annotLayer.parentElement);
    // Parent should have position: relative for overlay positioning
    expect(canvas.parentElement!.style.position).toBe("relative");
  });

  // -------------------------------------------------------------------------
  // Nav-seq guard: stale text/annotation layers must NOT paint over current page
  // -------------------------------------------------------------------------

  it("stale renderTextLayer from an earlier page is discarded on rapid navigation", async () => {
    const onPageChange = vi.fn();
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    // Wait for initial render to complete
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    // Track getTextContent calls after initial load.
    // First nav call (goToPage(1)) returns a deferred promise (slow page 1).
    // Second nav call (goToPage(2)) resolves immediately (fast page 2).
    let resolveStaleTc!: (v: { items: never[]; styles: object; lang: null }) => void;
    const staleTcPromise = new Promise<{ items: never[]; styles: object; lang: null }>((r) => {
      resolveStaleTc = r;
    });
    let tcCallCount = 0;
    mockGetTextContent.mockImplementation(() => {
      tcCallCount++;
      // The initial load already happened; first nav call = slow, rest = fast
      if (tcCallCount === 1) {
        return staleTcPromise;
      }
      return Promise.resolve({ items: [], styles: {}, lang: null });
    });

    // Clear mocks to track only nav-related calls
    MockTextLayer.mockClear();
    mockTextLayerRender.mockClear();

    // Rapid navigation: goToPage(1) then goToPage(2)
    await act(async () => {
      goToPage!(1);
      await Promise.resolve();
      await Promise.resolve();
      goToPage!(2);
    });

    // Wait for page 2 to fully render
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    // Record how many times MockTextLayer was constructed after page 2 rendered
    const textLayerCountAfterPage2 = MockTextLayer.mock.calls.length;

    // Now resolve the stale page 1 getTextContent
    await act(async () => {
      resolveStaleTc({ items: [], styles: {}, lang: null });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale text layer should NOT have been constructed/rendered
    expect(MockTextLayer.mock.calls.length).toBe(textLayerCountAfterPage2);
  });

  it("stale renderAnnotationLayer from an earlier page is discarded on rapid navigation", async () => {
    const onPageChange = vi.fn();
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    // Make annotations non-empty so AnnotationLayer would be constructed
    let resolveStaleAnnot!: (v: object[]) => void;
    const staleAnnotPromise = new Promise<object[]>((r) => {
      resolveStaleAnnot = r;
    });
    let annotCallCount = 0;
    mockGetAnnotations.mockImplementation(() => {
      annotCallCount++;
      if (annotCallCount === 1) {
        // Slow: stale page's getAnnotations
        return staleAnnotPromise;
      }
      // Fast: current page's getAnnotations — return non-empty
      return Promise.resolve([{ id: "link1", subtype: "Link", rect: [0, 0, 100, 100] }]);
    });

    MockAnnotationLayer.mockClear();
    mockAnnotationLayerRender.mockClear();

    await act(async () => {
      goToPage!(1);
      await Promise.resolve();
      await Promise.resolve();
      goToPage!(2);
    });

    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    const annotLayerCountAfterPage2 = MockAnnotationLayer.mock.calls.length;

    // Resolve stale page 1 getAnnotations with non-empty annotations
    await act(async () => {
      resolveStaleAnnot([{ id: "staleLink", subtype: "Link", rect: [0, 0, 50, 50] }]);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale annotation layer should NOT have been constructed/rendered
    expect(MockAnnotationLayer.mock.calls.length).toBe(annotLayerCountAfterPage2);
  });

  it("stale render does not clear the current text layer container", async () => {
    const onPageChange = vi.fn();
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    // First nav getTextContent is slow, second is fast
    let resolveStaleTc!: (v: { items: never[]; styles: object; lang: null }) => void;
    const staleTcPromise = new Promise<{ items: never[]; styles: object; lang: null }>((r) => {
      resolveStaleTc = r;
    });
    let tcCallCount = 0;
    mockGetTextContent.mockImplementation(() => {
      tcCallCount++;
      if (tcCallCount === 1) {
        return staleTcPromise;
      }
      return Promise.resolve({ items: [], styles: {}, lang: null });
    });

    await act(async () => {
      goToPage!(1);
      await Promise.resolve();
      await Promise.resolve();
      goToPage!(2);
    });

    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    // Place a sentinel in the text layer div to represent page 2's content
    const textLayerDiv = screen.getByTestId("pdf-text-layer");
    textLayerDiv.innerHTML = "<span>page2</span>";

    // Resolve the stale page 1 getTextContent
    await act(async () => {
      resolveStaleTc({ items: [], styles: {}, lang: null });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The sentinel should still be present — stale render must not clear it
    expect(textLayerDiv.innerHTML).toContain("page2");
  });

  // -------------------------------------------------------------------------
  // Zoom/nav race tests
  // -------------------------------------------------------------------------

  it("a navigation that starts during a zoom re-render wins (canvas/state reflect the navigated page)", async () => {
    const onPageChange = vi.fn();
    let goToPage: ((i: number) => void) | null = null;
    let getCurrentPage: (() => number) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerGoToPage={(fn) => { goToPage = fn; }}
        registerGetCurrentPage={(fn) => { getCurrentPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();
    expect(getCurrentPage).not.toBeNull();

    // Clear initial-load calls
    onPageChange.mockClear();
    mockGetPage.mockClear();
    mockRender.mockClear();

    // We need to control which getPage calls resolve and when.
    // The zoom will call getPage(1) for the current page (index 0).
    // The navigation will call getPage(3) for the target page (index 2).
    type PageObj = {
      getViewport: typeof mockGetViewport;
      render: typeof mockRender;
      getTextContent: typeof mockGetTextContent;
      getAnnotations: typeof mockGetAnnotations;
      cleanup: typeof mockPageCleanup;
    };
    let resolveZoomGetPage!: (v: PageObj) => void;
    const zoomGetPagePromise = new Promise<PageObj>((r) => { resolveZoomGetPage = r; });

    let getPageCallIdx = 0;
    mockGetPage.mockImplementation(() => {
      getPageCallIdx++;
      if (getPageCallIdx === 1) {
        // This is the zoom's getPage — deferred so we can interleave nav
        return zoomGetPagePromise;
      }
      // Navigation's getPage — resolves immediately
      return Promise.resolve({
        getViewport: mockGetViewport,
        render: mockRender,
        getTextContent: mockGetTextContent,
        getAnnotations: mockGetAnnotations,
        cleanup: mockPageCleanup,
      });
    });

    // 1. Trigger zoom (Cmd+=). This starts reRenderAtZoom which calls getPage.
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });
    // Let the zoom's async work start (it will be stuck at getPage)
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // 2. While the zoom's getPage is pending, navigate to page 2.
    await act(async () => {
      goToPage!(2);
      // Let the navigation's async work complete (its getPage resolves immediately)
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Navigation should have completed and fired onPageChange(2)
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    // Record how many render calls happened so far (nav's render)
    const renderCountBeforeZoomResolve = mockRender.mock.calls.length;

    // 3. Now resolve the zoom's deferred getPage (returns the stale page 0 object).
    //    With the fix, reRenderAtZoom should bail here because navSeq was bumped
    //    by goToPage. Without the fix, it would call renderPageToCanvas and
    //    overwrite the canvas with the stale page.
    await act(async () => {
      resolveZoomGetPage({
        getViewport: mockGetViewport,
        render: mockRender,
        getTextContent: mockGetTextContent,
        getAnnotations: mockGetAnnotations,
        cleanup: mockPageCleanup,
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 4. Assert: the zoom's stale getPage resolution must NOT have triggered
    //    another renderPageToCanvas call (which would have called page.render).
    expect(mockRender.mock.calls.length).toBe(renderCountBeforeZoomResolve);

    // The navigation's state must be intact
    expect(getCurrentPage!()).toBe(2);
    const callsAfterNav = onPageChange.mock.calls.map((c: unknown[]) => c[0]);
    const lastCall = callsAfterNav[callsAfterNav.length - 1];
    expect(lastCall).toBe(2);
  });

  it("a zoom that starts during a navigation re-render supersedes the slow nav render via navSeq", async () => {
    const onPageChange = vi.fn();
    let goToPage: ((i: number) => void) | null = null;
    let getCurrentPage: (() => number) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerGoToPage={(fn) => { goToPage = fn; }}
        registerGetCurrentPage={(fn) => { getCurrentPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();
    expect(getCurrentPage).not.toBeNull();

    // Clear initial-load calls
    onPageChange.mockClear();
    mockGetPage.mockClear();

    // Make the navigation's render task deferred (slow) so we can trigger zoom during it.
    let resolveNavRender!: () => void;
    const navRenderPromise = new Promise<void>((r) => { resolveNavRender = r; });
    let renderCallIdx = 0;
    mockRender.mockImplementation(() => {
      renderCallIdx++;
      if (renderCallIdx === 1) {
        // Navigation's render — slow
        return { promise: navRenderPromise, cancel: vi.fn() };
      }
      // Zoom's render — fast
      return { promise: Promise.resolve(), cancel: vi.fn() };
    });

    // 1. Start navigation to page 1. Its render will be slow.
    await act(async () => {
      goToPage!(1);
      // Let the navigation's async work proceed to the render step
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 2. While the nav render is pending, trigger a zoom (Cmd+=).
    //    With the fix, the zoom bumps navSeq, superseding the nav's in-flight render.
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 3. Resolve the nav's slow render.
    //    With the fix, the nav should detect its navSeq is stale after
    //    renderPageToCanvas returns and NOT call onPageChange.
    //    Without the fix, the nav would call onPageChange(1) since
    //    reRenderAtZoom never bumped navSeq.
    await act(async () => {
      resolveNavRender();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 4. The navigation's onPageChange(1) should NOT have fired because the
    //    zoom superseded it by bumping navSeqRef.
    //    (goToPage checks `if (navSeqRef.current !== mySeq) return` after renderPageToCanvas)
    expect(onPageChange).not.toHaveBeenCalledWith(1);

    // getCurrentPage still returns 1 because goToPage set currentPageRef synchronously
    expect(getCurrentPage!()).toBe(1);

    // The zoom should have called getPage for page 1 (1-based: 2)
    const getPageCalls = mockGetPage.mock.calls.map((c: unknown[]) => c[0]);
    expect(getPageCalls).toContain(2); // getPage(2) for page index 1
  });

  // -------------------------------------------------------------------------
  // Asset scope extension tests
  // -------------------------------------------------------------------------

  it("calls allow_asset_scope before loading the PDF document", async () => {
    const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
    mockedInvoke.mockResolvedValue(undefined);

    render(<PdfViewer filePath="/external/docs/paper.pdf" paneId="pane-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-canvas")).toBeInTheDocument();
    });

    // Verify allow_asset_scope was called with the correct path
    expect(mockedInvoke).toHaveBeenCalledWith("allow_asset_scope", {
      path: "/external/docs/paper.pdf",
    });

    // Verify allow_asset_scope was called BEFORE loadDocument
    const scopeIdx = mockedInvoke.mock.calls.findIndex(
      (c: unknown[]) => c[0] === "allow_asset_scope",
    );
    expect(scopeIdx).toBeGreaterThanOrEqual(0);
    const scopeCallOrder = mockedInvoke.mock.invocationCallOrder[scopeIdx]!;
    const loadCallOrder = mockLoadDocument.mock.invocationCallOrder[0]!;
    expect(scopeCallOrder).toBeLessThan(loadCallOrder);
  });

  it("shows error when allow_asset_scope fails for an inaccessible path", async () => {
    const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
    mockedInvoke.mockRejectedValue(new Error("path not found"));

    render(<PdfViewer filePath="/nonexistent/path/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      const error = screen.getByTestId("pdf-error");
      expect(error).toBeInTheDocument();
      expect(error.textContent).toContain("path not found");
    });
  });

  // -------------------------------------------------------------------------
  // Zoom keybinding propagation tests
  // -------------------------------------------------------------------------

  describe("zoom keybinding propagation", () => {
    // We spy on KeyboardEvent.prototype.stopImmediatePropagation to verify the
    // React handler reaches through to the native event. This is the only
    // reliable jsdom-level check: fireEvent dispatches a real KeyboardEvent, so
    // the spy fires when the component calls e.nativeEvent.stopImmediatePropagation().
    let sipSpy: ReturnType<typeof vi.spyOn>;
    let pdSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      sipSpy = vi.spyOn(KeyboardEvent.prototype, "stopImmediatePropagation");
      pdSpy = vi.spyOn(KeyboardEvent.prototype, "preventDefault");
    });

    afterEach(() => {
      sipSpy.mockRestore();
      pdSpy.mockRestore();
    });

    it("Cmd+= calls stopImmediatePropagation on the native event to prevent document-level handlers", async () => {
      render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
      });

      sipSpy.mockClear();
      pdSpy.mockClear();

      fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });

      expect(sipSpy).toHaveBeenCalled();
      expect(pdSpy).toHaveBeenCalled();
    });

    it("Cmd+- calls stopImmediatePropagation on the native event", async () => {
      render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
      });

      sipSpy.mockClear();
      pdSpy.mockClear();

      fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "-", metaKey: true });

      expect(sipSpy).toHaveBeenCalled();
      expect(pdSpy).toHaveBeenCalled();
    });

    it("Cmd+0 calls stopImmediatePropagation on the native event", async () => {
      render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
      });

      sipSpy.mockClear();
      pdSpy.mockClear();

      fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "0", metaKey: true });

      expect(sipSpy).toHaveBeenCalled();
      expect(pdSpy).toHaveBeenCalled();
    });

    it("plain = without modifier does NOT call stopImmediatePropagation", async () => {
      render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
      });

      sipSpy.mockClear();

      fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=" });

      expect(sipSpy).not.toHaveBeenCalled();
    });

    it("plain - without modifier does NOT call stopImmediatePropagation", async () => {
      render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
      });

      sipSpy.mockClear();

      fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "-" });

      expect(sipSpy).not.toHaveBeenCalled();
    });

    it("plain 0 without modifier does NOT call stopImmediatePropagation", async () => {
      render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
      });

      sipSpy.mockClear();

      fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "0" });

      expect(sipSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Page proxy cleanup tests (memory management)
  // -------------------------------------------------------------------------

  it("calls cleanup() on the previously-displayed page proxy after navigating away", async () => {
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    // Create per-page cleanup spies so we can distinguish which page was cleaned up.
    const page1Cleanup = vi.fn();
    const page2Cleanup = vi.fn();
    const pagesByNumber: Record<number, object> = {
      1: {
        getViewport: mockGetViewport,
        render: mockRender,
        getTextContent: mockGetTextContent,
        getAnnotations: mockGetAnnotations,
        cleanup: page1Cleanup,
      },
      2: {
        getViewport: mockGetViewport,
        render: mockRender,
        getTextContent: mockGetTextContent,
        getAnnotations: mockGetAnnotations,
        cleanup: page2Cleanup,
      },
    };

    // Override getPage to return distinct objects per page number.
    // The initial load already used a page object without cleanup; we need to
    // re-seed page 1 so the component's currentPageProxyRef holds our tracked object.
    // We do this by navigating to page 1 (index 0) via a zoom re-render path
    // that calls getPage(1). But the same-page guard prevents goToPage(0).
    // Instead, we set mockGetPage to return page-specific objects for the next navigations.
    (mockGetPage as ReturnType<typeof vi.fn>).mockImplementation((pageNum: number) =>
      Promise.resolve(pagesByNumber[pageNum] ?? {
        getViewport: mockGetViewport,
        render: mockRender,
        getTextContent: mockGetTextContent,
        getAnnotations: mockGetAnnotations,
        cleanup: vi.fn(),
      }),
    );

    // First, navigate away from page 0 to page 1 (index 1 -> getPage(2)).
    // The initial page proxy (from the mount load) should NOT trigger our spy
    // because it was created before we set up the per-page mocks.
    // But the NEW page (page number 2) should be stored as currentPageProxyRef.
    await act(async () => { goToPage!(1); });

    // Now navigate from page 1 (index 1) to page 2 (index 2 -> getPage(3)).
    // This should clean up the page number 2 proxy.
    page2Cleanup.mockClear();
    const page3Cleanup = vi.fn();
    pagesByNumber[3] = {
      getViewport: mockGetViewport,
      render: mockRender,
      getTextContent: mockGetTextContent,
      getAnnotations: mockGetAnnotations,
      cleanup: page3Cleanup,
    };

    await act(async () => { goToPage!(2); });

    // The page that was displayed before (page number 2 proxy) should have been cleaned up.
    await waitFor(() => {
      expect(page2Cleanup).toHaveBeenCalled();
    });
    // The new page (page number 3) should NOT have been cleaned up.
    expect(page3Cleanup).not.toHaveBeenCalled();
  });

  it("does not call cleanup() on the current page during zoom re-render", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // Set up a page object with a cleanup spy. Since getPage returns the same
    // object for the same page number (same mock), the component should detect
    // oldProxy === page and skip cleanup.
    const zoomCleanup = vi.fn();
    const zoomPage = {
      getViewport: mockGetViewport,
      render: mockRender,
      getTextContent: mockGetTextContent,
      getAnnotations: mockGetAnnotations,
      cleanup: zoomCleanup,
    };
    mockGetPage.mockImplementation(() => Promise.resolve(zoomPage));

    // Trigger zoom to store zoomPage as currentPageProxyRef. The zoom calls
    // getPage(currentPage+1) which returns zoomPage. Then fire another Cmd+=
    // to zoom again. The second zoom also returns the same zoomPage.
    // oldProxy === page => no cleanup.

    // First zoom: stores zoomPage as currentPageProxyRef
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });
    await waitFor(() => {
      expect(mockGetPage).toHaveBeenCalled();
    });
    // Wait for render to complete
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    zoomCleanup.mockClear();

    // Second zoom: same page, same proxy object returned by getPage
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });
    await waitFor(() => {
      // Wait for the second zoom getPage call
      expect(mockGetPage.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // cleanup should NOT have been called because it is the same proxy object
    expect(zoomCleanup).not.toHaveBeenCalled();
  });

  it("does not call cleanup() on the old page when navigation fails", async () => {
    let goToPage: ((i: number) => void) | null = null;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    // Give the current page proxy a cleanup spy by navigating successfully first
    const pageCleanup = vi.fn();
    const trackedPage = {
      getViewport: mockGetViewport,
      render: mockRender,
      getTextContent: mockGetTextContent,
      getAnnotations: mockGetAnnotations,
      cleanup: pageCleanup,
    };
    mockGetPage.mockImplementation(() => Promise.resolve(trackedPage));

    await act(async () => { goToPage!(1); });
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    pageCleanup.mockClear();

    // Now make getPage reject for the next navigation
    mockGetPage.mockRejectedValueOnce(new Error("page unavailable"));

    await act(async () => { goToPage!(2); });

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    // cleanup should NOT have been called — the code path never reached the cleanup section
    expect(pageCleanup).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Layer cache LRU eviction tests (Concern C — bounded cache)
  // -------------------------------------------------------------------------

  it("evicts the oldest cached page when more than LAYER_CACHE_CAP distinct pages are visited", async () => {
    // Use a 10-page document so we can exceed the LRU cap (5).
    const tenPageDoc = { ...mockDoc, numPages: 10 };
    mockLoadDocument.mockImplementation(() => Promise.resolve(tenPageDoc));

    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/big.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    // Wait for initial page 0's layer cache to be populated
    await waitFor(() => {
      expect(mockGetTextContent).toHaveBeenCalledTimes(1);
    });

    // Visit pages 1 through 5 (6 total pages visited: 0,1,2,3,4,5 — exceeds cap of 5).
    for (let i = 1; i <= 5; i++) {
      mockGetTextContent.mockClear();
      await act(async () => { goToPage!(i); });
      await waitFor(() => {
        expect(mockGetTextContent).toHaveBeenCalledTimes(1);
      });
    }

    // At this point pages 0..5 have been visited. With LRU cap=5, page 0
    // (the oldest) should have been evicted.
    mockGetTextContent.mockClear();

    // Revisit page 0 — if evicted, getTextContent must be called again.
    await act(async () => { goToPage!(0); });
    await waitFor(() => {
      expect(mockGetTextContent).toHaveBeenCalledTimes(1);
    });
  });

  it("revisiting a within-cap page is a cache hit (getTextContent NOT re-invoked)", async () => {
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    // Wait for page 0's layer cache to populate
    await waitFor(() => {
      expect(mockGetTextContent).toHaveBeenCalledTimes(1);
    });

    // Visit page 1 (now 2 pages cached: 0, 1 — well within cap of 5)
    mockGetTextContent.mockClear();
    await act(async () => { goToPage!(1); });
    await waitFor(() => {
      expect(mockGetTextContent).toHaveBeenCalledTimes(1);
    });

    // Revisit page 0 — should be a cache hit (within cap, not evicted)
    mockGetTextContent.mockClear();
    await act(async () => { goToPage!(0); });

    // Allow async layer work to complete
    await act(async () => {
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    // getTextContent should NOT have been called again
    expect(mockGetTextContent).not.toHaveBeenCalled();
  });

  it("same-page zoom after visiting multiple pages is still a cache hit", async () => {
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    // Wait for page 0's layer cache to populate
    await waitFor(() => {
      expect(mockGetTextContent).toHaveBeenCalledTimes(1);
    });

    // Visit page 1 then back to page 0 (both within cap)
    await act(async () => { goToPage!(1); });
    await waitFor(() => {
      expect(mockGetTextContent).toHaveBeenCalledTimes(2);
    });
    await act(async () => { goToPage!(0); });

    // Allow async layer work to settle
    await act(async () => {
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    mockGetTextContent.mockClear();

    // Zoom on current page (page 0) — should reuse cached data
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });
    await act(async () => {
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    // getTextContent should NOT have been called — zoom uses cache
    expect(mockGetTextContent).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Drag-to-pan tests
  // -------------------------------------------------------------------------

  describe("drag-to-pan", () => {
    it("Space + mousedown + mousemove pans the scroll container", async () => {
      render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
      });

      const canvas = screen.getByTestId("pdf-page-canvas");
      const scrollContainer = canvas.closest(".overflow-auto")!;
      Object.defineProperty(scrollContainer, "scrollLeft", { writable: true, value: 100 });
      Object.defineProperty(scrollContainer, "scrollTop", { writable: true, value: 200 });

      fireEvent.keyDown(window, { key: " " });
      fireEvent.mouseDown(scrollContainer, { clientX: 300, clientY: 400 });
      fireEvent.mouseMove(scrollContainer, { clientX: 250, clientY: 350 });

      expect(scrollContainer.scrollLeft).toBe(150);
      expect(scrollContainer.scrollTop).toBe(250);

      fireEvent.keyUp(window, { key: " " });
    });

    it("mousedown without Space does NOT pan", async () => {
      render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
      });

      const canvas = screen.getByTestId("pdf-page-canvas");
      const scrollContainer = canvas.closest(".overflow-auto")!;
      Object.defineProperty(scrollContainer, "scrollLeft", { writable: true, value: 100 });
      Object.defineProperty(scrollContainer, "scrollTop", { writable: true, value: 200 });

      fireEvent.mouseDown(scrollContainer, { clientX: 300, clientY: 400 });
      fireEvent.mouseMove(scrollContainer, { clientX: 250, clientY: 350 });

      expect(scrollContainer.scrollLeft).toBe(100);
      expect(scrollContainer.scrollTop).toBe(200);
    });

    it("mouseup stops panning — subsequent mousemove has no effect", async () => {
      render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
      });

      const canvas = screen.getByTestId("pdf-page-canvas");
      const scrollContainer = canvas.closest(".overflow-auto")!;
      Object.defineProperty(scrollContainer, "scrollLeft", { writable: true, value: 100 });
      Object.defineProperty(scrollContainer, "scrollTop", { writable: true, value: 200 });

      fireEvent.keyDown(window, { key: " " });
      fireEvent.mouseDown(scrollContainer, { clientX: 300, clientY: 400 });
      fireEvent.mouseMove(scrollContainer, { clientX: 250, clientY: 350 });
      fireEvent.mouseUp(scrollContainer);

      const leftAfterUp = scrollContainer.scrollLeft;
      const topAfterUp = scrollContainer.scrollTop;

      fireEvent.mouseMove(scrollContainer, { clientX: 200, clientY: 300 });

      expect(scrollContainer.scrollLeft).toBe(leftAfterUp);
      expect(scrollContainer.scrollTop).toBe(topAfterUp);

      fireEvent.keyUp(window, { key: " " });
    });

    it("releasing Space stops panning mid-drag", async () => {
      render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
      });

      const canvas = screen.getByTestId("pdf-page-canvas");
      const scrollContainer = canvas.closest(".overflow-auto")!;
      Object.defineProperty(scrollContainer, "scrollLeft", { writable: true, value: 100 });
      Object.defineProperty(scrollContainer, "scrollTop", { writable: true, value: 200 });

      fireEvent.keyDown(window, { key: " " });
      fireEvent.mouseDown(scrollContainer, { clientX: 300, clientY: 400 });
      fireEvent.mouseMove(scrollContainer, { clientX: 250, clientY: 350 });

      // Release Space while dragging
      fireEvent.keyUp(window, { key: " " });

      const leftAfterRelease = scrollContainer.scrollLeft;
      const topAfterRelease = scrollContainer.scrollTop;

      fireEvent.mouseMove(scrollContainer, { clientX: 200, clientY: 300 });

      expect(scrollContainer.scrollLeft).toBe(leftAfterRelease);
      expect(scrollContainer.scrollTop).toBe(topAfterRelease);
    });

    it("cursor: none at rest, grab when Space held, grabbing while Space+dragging", async () => {
      render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
      });

      const canvas = screen.getByTestId("pdf-page-canvas");
      const scrollContainer = canvas.closest(".overflow-auto")!;

      // At rest: no cursor class
      expect(scrollContainer.className).not.toContain("cursor-grab");
      expect(scrollContainer.className).not.toContain("cursor-grabbing");

      // Hold Space: cursor-grab
      fireEvent.keyDown(window, { key: " " });
      expect(scrollContainer.className).toContain("cursor-grab");
      expect(scrollContainer.className).not.toContain("cursor-grabbing");

      // Space + mousedown: cursor-grabbing
      fireEvent.mouseDown(scrollContainer, { clientX: 300, clientY: 400 });
      expect(scrollContainer.className).toContain("cursor-grabbing");

      // Release mouse: back to cursor-grab (Space still held)
      fireEvent.mouseUp(scrollContainer);
      expect(scrollContainer.className).toContain("cursor-grab");
      expect(scrollContainer.className).not.toContain("cursor-grabbing");

      // Release Space: no cursor class
      fireEvent.keyUp(window, { key: " " });
      expect(scrollContainer.className).not.toContain("cursor-grab");
      expect(scrollContainer.className).not.toContain("cursor-grabbing");
    });

    it("Space + click on annotation layer elements does not start panning", async () => {
      render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
      });

      const annotationLayer = screen.getByTestId("pdf-annotation-layer");
      const link = document.createElement("section");
      annotationLayer.appendChild(link);

      const canvas = screen.getByTestId("pdf-page-canvas");
      const scrollContainer = canvas.closest(".overflow-auto")!;
      Object.defineProperty(scrollContainer, "scrollLeft", { writable: true, value: 100 });
      Object.defineProperty(scrollContainer, "scrollTop", { writable: true, value: 200 });

      fireEvent.keyDown(window, { key: " " });
      fireEvent.mouseDown(link, { clientX: 300, clientY: 400 });
      fireEvent.mouseMove(scrollContainer, { clientX: 250, clientY: 350 });

      expect(scrollContainer.scrollLeft).toBe(100);
      expect(scrollContainer.scrollTop).toBe(200);

      fireEvent.keyUp(window, { key: " " });
    });
  });
});
