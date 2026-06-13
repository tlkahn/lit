import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
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

const mockGetAnnotations = vi.fn(() => Promise.resolve([]));

const mockGetPage = vi.fn(() =>
  Promise.resolve({
    getViewport: mockGetViewport,
    render: mockRender,
    getTextContent: mockGetTextContent,
    getAnnotations: mockGetAnnotations,
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
  mockGetPage.mockImplementation(() =>
    Promise.resolve({
      getViewport: mockGetViewport,
      render: mockRender,
      getTextContent: mockGetTextContent,
      getAnnotations: mockGetAnnotations,
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
  mockGetAnnotations.mockReturnValue(Promise.resolve([]));
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
      expect(screen.getByTestId("pdf-error")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
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

    // CSS width should reflect: viewport.width / canvasScale * cssScale
    // canvasScale = 4.0, cssScale = 6.0/4.0 = 1.5
    // viewport.width = 1224 (from mock), so CSS width = 1224 / 4.0 * 1.5 = 459
    const canvas = screen.getByTestId("pdf-page-canvas") as HTMLCanvasElement;
    expect(canvas.style.width).toBe("459px");
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

  it("text layer is re-rendered on zoom", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });

    mockGetTextContent.mockClear();
    MockTextLayer.mockClear();
    mockTextLayerRender.mockClear();

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });

    await waitFor(() => {
      expect(mockGetTextContent).toHaveBeenCalled();
    });
    expect(mockTextLayerRender).toHaveBeenCalled();
  });

  it("text layer div has className textLayer", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      const textLayer = screen.getByTestId("pdf-text-layer");
      expect(textLayer.className).toContain("textLayer");
    });
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
});
