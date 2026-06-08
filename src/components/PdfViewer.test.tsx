import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { PdfViewer } from "./PdfViewer";
import { mockInvoke } from "../test/tauri-mock";

const mockPdfInfo = { page_count: 3, path: "/test/doc.pdf" };
const mockRenderedPage = {
  page_index: 0,
  png_path: "/tmp/lit-pdf-test/page_0.png",
  width: 1224,
  height: 1584,
};

beforeEach(() => {
  Object.defineProperty(window, "devicePixelRatio", {
    writable: true,
    value: 1,
  });
  mockInvoke((cmd, args) => {
    switch (cmd) {
      case "pdf_open":
        return mockPdfInfo;
      case "pdf_render_page": {
        const a = args as Record<string, unknown>;
        const idx = a?.pageIndex ?? 0;
        return { ...mockRenderedPage, page_index: idx, png_path: `/tmp/lit-pdf-test/page_${idx}.png` };
      }
      case "pdf_prefetch":
        return null;
      case "pdf_close":
        return null;
      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  });
});

describe("PdfViewer", () => {
  it("renders an img with asset protocol src", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.src).toContain("asset://localhost/");
      expect(img.src).not.toContain("data:image/png;base64");
    });
  });

  it("calls onPageCount with page_count on mount", async () => {
    const onPageCount = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageCount={onPageCount} />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    expect(onPageCount).toHaveBeenCalledWith(3);
  });

  it("calls pdfOpen on mount and pdfClose on unmount", async () => {
    const { unmount } = render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("pdf_open", { path: "/test/doc.pdf", paneId: "pane-1" });

    unmount();

    expect(invoke).toHaveBeenCalledWith("pdf_close", { paneId: "pane-1" });
  });

  it("shows loading state initially", () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    expect(screen.getByTestId("pdf-loading")).toBeInTheDocument();
  });

  it("shows error state on failure", async () => {
    mockInvoke((cmd) => {
      if (cmd === "pdf_open") throw new Error("Failed to open PDF");
      if (cmd === "pdf_close") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<PdfViewer filePath="/bad/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      const error = screen.getByTestId("pdf-error");
      expect(error).toBeInTheDocument();
      expect(error.textContent).toContain("Failed to open PDF");
    });
  });

  it("passes DPI = 144 × devicePixelRatio to pdfRenderPage", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2 });
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("pdf_render_page", {
      pageIndex: 0,
      dpi: 288,
      paneId: "pane-1",
    });
  });

  it("sets CSS width to rendered.width / devicePixelRatio", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2 });
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.style.width).toBe("612px");
    });
  });

  it("serves cached page without re-invoking pdf_render_page", async () => {
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
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    const { invoke } = await import("@tauri-apps/api/core");

    goToPage!(1);
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    const callsBefore = (invoke as unknown as ReturnType<typeof import("vitest").vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page").length;

    goToPage!(0);
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(0);
    });

    const callsAfter = (invoke as unknown as ReturnType<typeof import("vitest").vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page").length;

    expect(callsAfter).toBe(callsBefore);
  });

  it("clears cache when filePath changes", async () => {
    const { rerender } = render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof import("vitest").vi.fn>).mockClear();

    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "pdf_open":
          return { page_count: 2, path: "/test/other.pdf" };
        case "pdf_render_page": {
          const a = args as Record<string, unknown>;
          const idx = a?.pageIndex ?? 0;
          return { ...mockRenderedPage, page_index: idx, png_path: `/tmp/lit-pdf-test/page_${idx}.png` };
        }
        case "pdf_prefetch":
          return null;
        case "pdf_close":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    rerender(<PdfViewer filePath="/test/other.pdf" paneId="pane-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    expect(invoke).toHaveBeenCalledWith("pdf_render_page", expect.objectContaining({ pageIndex: 0 }));
  });

  it("prefetches adjacent pages after rendering current page", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    const prefetchCalls = (invoke as unknown as ReturnType<typeof import("vitest").vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_prefetch");

    expect(prefetchCalls).toHaveLength(1);
    expect(prefetchCalls[0]![1]).toEqual(expect.objectContaining({ pageIndex: 1 }));
  });

  it("prefetches both neighbors on middle page", async () => {
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
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof import("vitest").vi.fn>).mockClear();

    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "pdf_render_page": {
          const a = args as Record<string, unknown>;
          const idx = a?.pageIndex ?? 0;
          return { ...mockRenderedPage, page_index: idx, png_path: `/tmp/lit-pdf-test/page_${idx}.png` };
        }
        case "pdf_prefetch":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    goToPage!(1);
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    const prefetchCalls = (invoke as unknown as ReturnType<typeof import("vitest").vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_prefetch");

    const prefetchedPages = prefetchCalls.map(
      (c: unknown[]) => (c[1] as Record<string, unknown>).pageIndex
    );
    expect(prefetchedPages).toContain(0);
    expect(prefetchedPages).toContain(2);
  });

  it("shows spinner during initial loading", () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    const loading = screen.getByTestId("pdf-loading");
    expect(loading.querySelector("svg")).toBeInTheDocument();
    expect(loading.textContent).toContain("Loading PDF…");
  });

  it("shows spinner overlay during page navigation (cache miss)", async () => {
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    let resolveRender!: (v: unknown) => void;
    const deferred = new Promise((r) => {
      resolveRender = r;
    });
    mockInvoke((cmd) => {
      if (cmd === "pdf_render_page") return deferred;
      if (cmd === "pdf_prefetch") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    goToPage!(1);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-loading")).toBeInTheDocument();
    });
    expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();

    resolveRender({ ...mockRenderedPage, page_index: 1, png_path: "/tmp/lit-pdf-test/page_1.png" });

    await waitFor(() => {
      expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
    });
  });

  it("does not show spinner overlay on cache hit", async () => {
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
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    goToPage!(1);
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    goToPage!(0);
    await waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(0);
    });

    expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
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
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    mockInvoke((cmd) => {
      if (cmd === "pdf_render_page") throw new Error("render failed");
      if (cmd === "pdf_prefetch") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    goToPage!(1);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-error")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
  });

  it("evicts oldest entry when cache exceeds MAX_CACHE", async () => {
    const bigPdfInfo = { page_count: 14, path: "/test/big.pdf" };
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "pdf_open":
          return bigPdfInfo;
        case "pdf_render_page": {
          const a = args as Record<string, unknown>;
          const idx = a?.pageIndex ?? 0;
          return { ...mockRenderedPage, page_index: idx, png_path: `/tmp/lit-pdf-test/page_${idx}.png` };
        }
        case "pdf_prefetch":
          return null;
        case "pdf_close":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    let goToPage: ((i: number) => void) | null = null;
    const onPageChange = vi.fn();
    render(
      <PdfViewer
        filePath="/test/big.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    for (let i = 1; i <= 13; i++) {
      goToPage!(i);
      await waitFor(() => {
        expect(onPageChange).toHaveBeenCalledWith(i);
      });
    }

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof import("vitest").vi.fn>).mockClear();

    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "pdf_render_page": {
          const a = args as Record<string, unknown>;
          const idx = a?.pageIndex ?? 0;
          return { ...mockRenderedPage, page_index: idx, png_path: `/tmp/lit-pdf-test/page_${idx}.png` };
        }
        case "pdf_prefetch":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    for (let i = 12; i >= 0; i--) {
      goToPage!(i);
      await waitFor(() => {
        expect(onPageChange).toHaveBeenLastCalledWith(i);
      });
    }

    const renderCalls = (invoke as unknown as ReturnType<typeof import("vitest").vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page");
    expect(renderCalls.length).toBeGreaterThan(0);
  });

  it("retains the 10 most-recent pages in the render cache (MAX_CACHE=10)", async () => {
    const bigPdfInfo = { page_count: 12, path: "/test/big.pdf" };
    let goToPage: ((i: number) => void) | null = null;
    const onPageChange = vi.fn();
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "pdf_open":
          return bigPdfInfo;
        case "pdf_render_page": {
          const a = args as Record<string, unknown>;
          const idx = a?.pageIndex ?? 0;
          return { ...mockRenderedPage, page_index: idx, png_path: `/tmp/lit-pdf-test/page_${idx}.png` };
        }
        case "pdf_prefetch":
          return null;
        case "pdf_close":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    render(
      <PdfViewer
        filePath="/test/big.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    for (let i = 1; i <= 10; i++) {
      goToPage!(i);
      await waitFor(() => {
        expect(onPageChange).toHaveBeenCalledWith(i);
      });
    }

    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    const rendersOf = (idx: number) =>
      invokeMock.mock.calls.filter(
        (c: unknown[]) =>
          c[0] === "pdf_render_page" && (c[1] as { pageIndex?: number })?.pageIndex === idx,
      ).length;

    const page1Before = rendersOf(1);
    goToPage!(1);
    await waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(1);
    });
    expect(rendersOf(1)).toBe(page1Before);

    const page0Before = rendersOf(0);
    goToPage!(0);
    await waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(0);
    });
    expect(rendersOf(0)).toBeGreaterThan(page0Before);
  });

  it("J navigates to the next page", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "j" });

    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });
  });

  it("advances two pages on a rapid double key-press without dropping one", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const viewer = screen.getByTestId("pdf-viewer");
    fireEvent.keyDown(viewer, { key: "j" });
    fireEvent.keyDown(viewer, { key: "j" });

    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(2);
    });
  });

  it("ArrowRight navigates to the next page", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
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
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    const before = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page").length;

    onPageChange.mockClear();
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "k" });

    await Promise.resolve();
    expect(onPageChange).not.toHaveBeenCalled();
    const after = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page").length;
    expect(after).toBe(before);
  });

  it("J on the last page is a no-op", async () => {
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
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
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
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
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
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "j" });

    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });
  });

  it("ignores a `page` prop and does not navigate from it (imperative-only navigation)", async () => {
    const onPageChange = vi.fn();
    render(
      <PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} {...({ page: 2 } as unknown as Record<string, never>)} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    await Promise.resolve();

    const { invoke } = await import("@tauri-apps/api/core");
    const renderedPage2 = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page")
      .some((c: unknown[]) => (c[1] as { pageIndex?: number })?.pageIndex === 2);

    expect(renderedPage2).toBe(false);
    expect(onPageChange).toHaveBeenCalledWith(0);
    expect(onPageChange).not.toHaveBeenCalledWith(2);
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
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    onPageChange.mockClear();
    goToPage!(0);

    await waitFor(() => {
      expect(onPageChange).not.toHaveBeenCalled();
    });
  });

  it("does not revert to an earlier page when a slow render resolves after a newer cache-hit navigation", async () => {
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
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    goToPage!(2);
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    // Install a mock where page index 1 renders slowly (deferred), so a
    // navigation to page 1 is an awaiting cache miss.
    let resolveSlow!: (v: unknown) => void;
    const slow = new Promise((r) => { resolveSlow = r; });
    mockInvoke((cmd, args) => {
      if (cmd === "pdf_render_page") {
        const a = args as Record<string, unknown>;
        const idx = (a?.pageIndex ?? 0) as number;
        if (idx === 1) return slow;
        return { ...mockRenderedPage, page_index: idx, png_path: `/tmp/lit-pdf-test/page_${idx}.png` };
      }
      if (cmd === "pdf_prefetch") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    onPageChange.mockClear();

    goToPage!(1);
    goToPage!(0);

    await waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(0);
    });

    resolveSlow({ ...mockRenderedPage, page_index: 1, png_path: "/tmp/lit-pdf-test/page_1.png" });

    await Promise.resolve();

    const pageChanges = onPageChange.mock.calls.map((c) => c[0]);
    expect(pageChanges[pageChanges.length - 1]).toBe(0);
    expect(onPageChange).not.toHaveBeenCalledWith(1);
  });

  it("keeps spinner while a superseding cache-miss navigation is still rendering after a stale render resolves", async () => {
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
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    // Two distinct deferred renders: page index 1 (navigation A) and page index
    // 2 (navigation B). Both are cache misses — page 0 is cached from mount,
    // pages 1 and 2 were never pre-warmed.
    let resolveA!: (v: unknown) => void;
    let resolveB!: (v: unknown) => void;
    const renderA = new Promise((r) => { resolveA = r; });
    const renderB = new Promise((r) => { resolveB = r; });
    mockInvoke((cmd, args) => {
      if (cmd === "pdf_render_page") {
        const a = args as Record<string, unknown>;
        const idx = (a?.pageIndex ?? 0) as number;
        if (idx === 1) return renderA;
        if (idx === 2) return renderB;
        return { ...mockRenderedPage, page_index: idx, png_path: `/tmp/lit-pdf-test/page_${idx}.png` };
      }
      if (cmd === "pdf_prefetch") return null;
      if (cmd === "pdf_close") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    // Navigation A to page index 1 (spinner on, mySeq = N), then immediately
    // navigation B to page index 2 (supersedes A, mySeq = N+1, spinner stays on).
    goToPage!(1);
    goToPage!(2);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-loading")).toBeInTheDocument();
    });

    // Resolve the STALE older render A. Its finally must NOT tear down the
    // spinner, because the superseding navigation B is still in flight. Wrap in
    // act so A's full continuation chain (await body -> finally -> setState) is
    // flushed and any (buggy) unconditional setPageLoading(false) is committed
    // to the DOM before we assert.
    await act(async () => {
      resolveA({ ...mockRenderedPage, page_index: 1, png_path: "/tmp/lit-pdf-test/page_1.png" });
      await renderA;
    });

    // Spinner MUST still be present: the current navigation B is still
    // rendering. On the buggy unconditional finally this is null (RED).
    expect(screen.queryByTestId("pdf-page-loading")).toBeInTheDocument();

    // Now resolve the current render B — it owns spinner teardown and commits.
    resolveB({ ...mockRenderedPage, page_index: 2, png_path: "/tmp/lit-pdf-test/page_2.png" });

    await waitFor(() => {
      expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
    });
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("constrains image to container at default zoom but not when zoomed in", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2 });
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument());
    const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
    expect(img.style.maxWidth).toBe("100%");

    const container = screen.getByTestId("pdf-scroll-container");
    fireEvent.wheel(container, { ctrlKey: true, deltaY: -100 });
    await waitFor(() => {
      const zoomedImg = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(zoomedImg.style.maxWidth).toBe("none");
    });
  });

  it("ctrl+scroll up zooms in", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument());
    const container = screen.getByTestId("pdf-scroll-container");
    fireEvent.wheel(container, { ctrlKey: true, deltaY: -100 });
    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      const scale = parseFloat(img.style.transform.match(/scale\(([0-9.]+)\)/)?.[1] ?? "1");
      expect(scale).toBeGreaterThan(1);
    });
  });

  it("ctrl+scroll down zooms out", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument());
    const container = screen.getByTestId("pdf-scroll-container");
    fireEvent.wheel(container, { ctrlKey: true, deltaY: 100 });
    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      const scale = parseFloat(img.style.transform.match(/scale\(([0-9.]+)\)/)?.[1] ?? "1");
      expect(scale).toBeLessThan(1);
    });
  });

  it("clamps zoom to 25%-400%", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument());
    const container = screen.getByTestId("pdf-scroll-container");
    for (let i = 0; i < 50; i++) fireEvent.wheel(container, { ctrlKey: true, deltaY: -200 });
    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      const scale = parseFloat(img.style.transform.match(/scale\(([0-9.]+)\)/)?.[1] ?? "1");
      expect(scale).toBeCloseTo(4, 1);
    });
    for (let i = 0; i < 50; i++) fireEvent.wheel(container, { ctrlKey: true, deltaY: 200 });
    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      const scale = parseFloat(img.style.transform.match(/scale\(([0-9.]+)\)/)?.[1] ?? "1");
      expect(scale).toBeCloseTo(0.25, 1);
    });
  });

  it("plain scroll (no modifier) does not zoom", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument());
    const container = screen.getByTestId("pdf-scroll-container");
    fireEvent.wheel(container, { deltaY: -100 });
    await Promise.resolve();
    const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
    expect(img.style.transform).toBe("scale(1)");
  });

  it("applies CSS scale transform and scaled wrapper size on zoom", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument());
    const container = screen.getByTestId("pdf-scroll-container");
    fireEvent.wheel(container, { ctrlKey: true, deltaY: -100 });
    await waitFor(() => {
      const wrapper = screen.getByTestId("pdf-zoom-wrapper");
      expect(wrapper.style.width).not.toBe("");
      expect(wrapper.style.height).not.toBe("");
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.style.transform).toContain("scale(");
      expect(img.style.transformOrigin).toBe("top left");
    });
  });

  it("ctrl+= zooms in by factor", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument());
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", ctrlKey: true });
    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      const scale = parseFloat(img.style.transform.match(/scale\(([0-9.]+)\)/)?.[1] ?? "1");
      expect(scale).toBeCloseTo(1.25, 2);
    });
  });

  it("ctrl+- zooms out by factor", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument());
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "-", ctrlKey: true });
    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      const scale = parseFloat(img.style.transform.match(/scale\(([0-9.]+)\)/)?.[1] ?? "1");
      expect(scale).toBeCloseTo(0.8, 2);
    });
  });

  it("ctrl+0 resets zoom to 100%", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument());
    const viewer = screen.getByTestId("pdf-viewer");
    fireEvent.keyDown(viewer, { key: "=", ctrlKey: true });
    fireEvent.keyDown(viewer, { key: "=", ctrlKey: true });
    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      const scale = parseFloat(img.style.transform.match(/scale\(([0-9.]+)\)/)?.[1] ?? "1");
      expect(scale).toBeGreaterThan(1);
    });
    fireEvent.keyDown(viewer, { key: "0", ctrlKey: true });
    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.style.transform).toBe("scale(1)");
    });
  });

  it("re-renders at zoomed DPI after 300ms debounce", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument());

    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

    const viewer = screen.getByTestId("pdf-viewer");

    // Switch to fake timers only now (mount + initial render done under real timers).
    vi.useFakeTimers();
    try {
      act(() => {
        fireEvent.keyDown(viewer, { key: "=", ctrlKey: true });
        fireEvent.keyDown(viewer, { key: "=", ctrlKey: true });
      });

      // 1.25 * 1.25 = 1.5625 -> 156% -> dpi = round(144 * 1.5625) = 225
      const expectedDpi = Math.round(144 * 1.5625);

      // Before the debounce elapses, no sharp re-render at the zoomed DPI yet.
      const before = invokeMock.mock.calls.filter(
        (c: unknown[]) =>
          c[0] === "pdf_render_page" && (c[1] as { dpi?: number })?.dpi === expectedDpi,
      );
      expect(before).toHaveLength(0);

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      const after = invokeMock.mock.calls.filter(
        (c: unknown[]) =>
          c[0] === "pdf_render_page" && (c[1] as { dpi?: number })?.dpi === expectedDpi,
      );
      expect(after.length).toBeGreaterThan(0);
      expect(after[0]![1]).toEqual({ pageIndex: 0, dpi: expectedDpi, paneId: "pane-1" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets CSS scale to 1 and swaps img src after sharp re-render", async () => {
    // Vary png_path and dimensions by the requested dpi so we can observe the
    // bitmap swap (src change) and the wrapper sharpening (baseW grows).
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "pdf_open":
          return mockPdfInfo;
        case "pdf_render_page": {
          const a = args as Record<string, unknown>;
          const idx = (a?.pageIndex ?? 0) as number;
          const dpi = (a?.dpi ?? 144) as number;
          return {
            page_index: idx,
            png_path: `/tmp/lit-pdf-test/page_${idx}_dpi${dpi}.png`,
            width: Math.round(1224 * (dpi / 144)),
            height: Math.round(1584 * (dpi / 144)),
          };
        }
        case "pdf_prefetch":
          return null;
        case "pdf_close":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument());

    const img0 = screen.getByTestId("pdf-page-image") as HTMLImageElement;
    const srcBefore = img0.src;
    const wrapperWidthBefore = parseFloat(
      (screen.getByTestId("pdf-zoom-wrapper") as HTMLElement).style.width,
    );

    const viewer = screen.getByTestId("pdf-viewer");

    vi.useFakeTimers();
    try {
      act(() => {
        fireEvent.keyDown(viewer, { key: "=", ctrlKey: true });
        fireEvent.keyDown(viewer, { key: "=", ctrlKey: true });
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      // Sharp render at higher DPI: src points at the higher-dpi bitmap.
      expect(img.src).not.toBe(srcBefore);
      expect(img.src).toContain("dpi225");
      // cssScale collapses to 1 once the bitmap is rendered at the target zoom.
      expect(img.style.transform).toBe("scale(1)");
    });

    // Wrapper grew because baseW now reflects the enlarged bitmap.
    const wrapperWidthAfter = parseFloat(
      (screen.getByTestId("pdf-zoom-wrapper") as HTMLElement).style.width,
    );
    expect(wrapperWidthAfter).toBeGreaterThan(wrapperWidthBefore);
  });

  it("keeps CSS upscale (cssScale = zoomLevel) when navigating to another page while zoomed", async () => {
    // Vary png_path and dimensions by the requested dpi so cssScale is
    // observable via img.style.transform and the bitmap's source DPI is visible.
    let goToPage: ((i: number) => void) | null = null;
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "pdf_open":
          return mockPdfInfo;
        case "pdf_render_page": {
          const a = args as Record<string, unknown>;
          const idx = (a?.pageIndex ?? 0) as number;
          const dpi = (a?.dpi ?? 144) as number;
          return {
            page_index: idx,
            png_path: `/tmp/lit-pdf-test/page_${idx}_dpi${dpi}.png`,
            width: Math.round(1224 * (dpi / 144)),
            height: Math.round(1584 * (dpi / 144)),
          };
        }
        case "pdf_prefetch":
          return null;
        case "pdf_close":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => {
          goToPage = fn;
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();

    const viewer = screen.getByTestId("pdf-viewer");

    vi.useFakeTimers();
    try {
      act(() => {
        fireEvent.keyDown(viewer, { key: "=", ctrlKey: true });
        fireEvent.keyDown(viewer, { key: "=", ctrlKey: true });
      });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.style.transform).toBe("scale(1)");
      expect(img.src).toContain("dpi225");
    });

    let scaleAtBaseCommit: number | null = null;
    act(() => {
      goToPage!(1);
    });
    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.src).toContain("page_1_dpi144");
      const m = img.style.transform.match(/scale\(([0-9.]+)\)/);
      expect(m?.[1]).toBeDefined();
      scaleAtBaseCommit = parseFloat(m![1]!);
    });

    expect(scaleAtBaseCommit).toBeCloseTo(1.5625, 2);
  });

  it("ignores a stale lower-zoom sharp render that resolves after a newer higher-zoom one", async () => {
    // Two sequential debounced renderSharp calls can be in flight at once:
    // renderSharp(lower) starts (debounce A fired), then a further zoom fires
    // debounce B -> renderSharp(higher). If the HIGHER render resolves first and
    // commits, then the LOWER render resolves late, it must NOT overwrite the
    // committed higher-zoom bitmap/scale. Without a zoom-generation guard the
    // stale lower render passes the file+page guards and reverts renderedZoomRef.
    let resolveLow!: (v: unknown) => void;
    let resolveHigh!: (v: unknown) => void;
    const lowPromise = new Promise((r) => { resolveLow = r; });
    const highPromise = new Promise((r) => { resolveHigh = r; });
    // DPIs: zoom 1.5625 -> dpi 225; zoom ~1.953 -> dpi 281. Keyed by dpi so we
    // can defer each independently and resolve them out of order.
    const LOW_DPI = 225;
    const HIGH_DPI = 281;
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "pdf_open":
          return mockPdfInfo;
        case "pdf_render_page": {
          const a = args as Record<string, unknown>;
          const idx = (a?.pageIndex ?? 0) as number;
          const dpi = (a?.dpi ?? 144) as number;
          const page = {
            page_index: idx,
            png_path: `/tmp/lit-pdf-test/page_${idx}_dpi${dpi}.png`,
            width: Math.round(1224 * (dpi / 144)),
            height: Math.round(1584 * (dpi / 144)),
          };
          if (dpi === LOW_DPI) return lowPromise.then(() => page);
          if (dpi === HIGH_DPI) return highPromise.then(() => page);
          return page;
        }
        case "pdf_prefetch":
          return null;
        case "pdf_close":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument());

    const viewer = screen.getByTestId("pdf-viewer");

    vi.useFakeTimers();
    try {
      // Zoom to 1.5625 (156%) and let debounce A fire -> renderSharp(1.5625)
      // which awaits lowPromise (in flight, uncommitted).
      act(() => {
        fireEvent.keyDown(viewer, { key: "=", ctrlKey: true });
        fireEvent.keyDown(viewer, { key: "=", ctrlKey: true });
      });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      act(() => {
        fireEvent.keyDown(viewer, { key: "=", ctrlKey: true });
      });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    } finally {
      vi.useRealTimers();
    }

    // Resolve the HIGHER render first: it commits the 281-dpi bitmap and sets
    // renderedZoomRef = 1.953, so cssScale collapses to 1.
    await act(async () => {
      resolveHigh(null);
      await highPromise;
    });

    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.src).toContain(`dpi${HIGH_DPI}`);
      expect(img.style.transform).toBe("scale(1)");
    });

    // Now resolve the STALE lower render. It is superseded and must NOT revert
    // the bitmap or scale. Before the fix it overwrites renderedZoomRef = 1.5625
    // and swaps in the 225-dpi bitmap, giving cssScale = 1.953/1.5625 = 1.25.
    await act(async () => {
      resolveLow(null);
      await lowPromise;
    });

    const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
    expect(img.src).toContain(`dpi${HIGH_DPI}`);
    expect(img.src).not.toContain(`dpi${LOW_DPI}`);
    expect(img.style.transform).toBe("scale(1)");
  });

  it("preserves viewport center when zooming", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument());

    const container = screen.getByTestId("pdf-scroll-container") as HTMLDivElement;
    // jsdom reports clientWidth/Height as 0 and scrollTop/Left as read-only;
    // back them with mutable storage so the impl can read and write them.
    let scrollTop = 100;
    let scrollLeft = 50;
    Object.defineProperty(container, "clientWidth", { configurable: true, get: () => 800 });
    Object.defineProperty(container, "clientHeight", { configurable: true, get: () => 600 });
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
    });
    Object.defineProperty(container, "scrollLeft", {
      configurable: true,
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = v;
      },
    });

    // One ctrl+= press: zoom 1 -> 1.25.
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", ctrlKey: true });

    // newScroll = (oldScroll + clientSize/2) * newZoom/oldZoom - clientSize/2
    // top:  (100 + 300) * 1.25 - 300 = 200
    // left: (50  + 400) * 1.25 - 400 = 162.5
    await waitFor(() => {
      expect(scrollTop).toBeCloseTo(200, 1);
      expect(scrollLeft).toBeCloseTo(162.5, 1);
    });
  });

  it("debounce resets on rapid zoom; renders only final DPI", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument());

    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    const viewer = screen.getByTestId("pdf-viewer");

    vi.useFakeTimers();
    try {
      // First zoom press: 1 -> 1.25 (125%).
      act(() => {
        fireEvent.keyDown(viewer, { key: "=", ctrlKey: true });
      });
      // 1.25 -> dpi 180
      const intermediateDpi = Math.round(144 * 1.25);

      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      // Second zoom press resets the debounce: 1.25 -> 1.5625 (~156%).
      act(() => {
        fireEvent.keyDown(viewer, { key: "=", ctrlKey: true });
      });
      // 1.5625 -> dpi 225
      const finalDpi = Math.round(144 * 1.5625);

      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      // The debounce was reset before 300ms elapsed: NO render at the
      // intermediate DPI should have fired.
      const intermediate = invokeMock.mock.calls.filter(
        (c: unknown[]) =>
          c[0] === "pdf_render_page" && (c[1] as { dpi?: number })?.dpi === intermediateDpi,
      );
      expect(intermediate).toHaveLength(0);

      // Now let the (reset) debounce fully elapse.
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      const finalCalls = invokeMock.mock.calls.filter(
        (c: unknown[]) =>
          c[0] === "pdf_render_page" && (c[1] as { dpi?: number })?.dpi === finalDpi,
      );
      expect(finalCalls.length).toBeGreaterThan(0);

      // Still no intermediate-DPI render ever fired.
      const intermediateAfter = invokeMock.mock.calls.filter(
        (c: unknown[]) =>
          c[0] === "pdf_render_page" && (c[1] as { dpi?: number })?.dpi === intermediateDpi,
      );
      expect(intermediateAfter).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
