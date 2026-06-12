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

  it("calls onPageCount with the page count on initial load", async () => {
    const onPageCount = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageCount={onPageCount} />);

    await waitFor(() => {
      expect(onPageCount).toHaveBeenCalledWith(3);
    });
    expect(onPageCount).toHaveBeenCalledTimes(1);
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

  it("shows loading state immediately when filePath changes (no stale page visible)", async () => {
    const { rerender } = render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    // Wait for the initial load to complete.
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    // Seed loadedSrc so the old image is considered "painted".
    fireEvent.load(screen.getByTestId("pdf-page-image"));

    // Set up a new mock where pdf_open returns a deferred (unresolved) promise
    // so the new file's load hangs — simulating a slow backend open.
    let resolvePdfOpen!: (v: unknown) => void;
    const deferredOpen = new Promise((r) => { resolvePdfOpen = r; });
    mockInvoke((cmd) => {
      if (cmd === "pdf_open") return deferredOpen;
      if (cmd === "pdf_close") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    // Switch to a different PDF file.
    rerender(<PdfViewer filePath="/test/other.pdf" paneId="pane-1" />);

    // The full "Loading PDF…" screen should appear immediately — not the old
    // page with no spinner.
    await waitFor(() => {
      expect(screen.getByTestId("pdf-loading")).toBeInTheDocument();
    });
    // The old page image must be gone.
    expect(screen.queryByTestId("pdf-page-image")).not.toBeInTheDocument();

    // Clean up: resolve the deferred open so the effect's async block settles.
    resolvePdfOpen({ page_count: 2, path: "/test/other.pdf" });
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
      expect((screen.getByTestId("pdf-page-image") as HTMLImageElement).src).toContain("page_1.png");
    });
    fireEvent.load(screen.getByTestId("pdf-page-image"));

    await waitFor(() => {
      expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
    });
  });

  it("does not show spinner overlay once a cache-hit page has painted", async () => {
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
    fireEvent.load(screen.getByTestId("pdf-page-image"));

    goToPage!(1);
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });
    fireEvent.load(screen.getByTestId("pdf-page-image"));

    goToPage!(0);
    await waitFor(() => {
      const calls = onPageChange.mock.calls.map((c) => c[0]);
      expect(calls.filter((c: number) => c === 0).length).toBeGreaterThanOrEqual(2);
    });
    fireEvent.load(screen.getByTestId("pdf-page-image"));

    // Outlast the spinner grace period to prove it never appears for a
    // painted cache hit.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
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
    const bigPdfInfo = { page_count: 8, path: "/test/big.pdf" };
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

    const onPageChange = vi.fn();
    let goToPage: ((i: number) => void) | null = null;
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

    for (let i = 0; i < 6; i++) {
      goToPage!(i + 1);
      await waitFor(() => {
        expect(onPageChange).toHaveBeenCalledWith(i + 1);
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

    for (let i = 5; i >= 0; i--) {
      goToPage!(i);
      await waitFor(() => {
        expect(onPageChange).toHaveBeenCalledWith(i);
      });
    }

    const renderCalls = (invoke as unknown as ReturnType<typeof import("vitest").vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page");
    expect(renderCalls.length).toBeGreaterThan(0);
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
      const pageChanges = onPageChange.mock.calls.map((c) => c[0]);
      expect(pageChanges).toContain(2);
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

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "k" });

    const after = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page").length;
    expect(after).toBe(before);
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
    render(
      <PdfViewer filePath="/test/doc.pdf" paneId="pane-1" {...({ page: 2 } as unknown as Record<string, never>)} />,
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
      expect(onPageChange).toHaveBeenCalledWith(0);
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

    goToPage!(1);
    goToPage!(2);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-loading")).toBeInTheDocument();
    });

    await act(async () => {
      resolveA({ ...mockRenderedPage, page_index: 1, png_path: "/tmp/lit-pdf-test/page_1.png" });
      await renderA;
    });

    expect(screen.queryByTestId("pdf-page-loading")).toBeInTheDocument();

    resolveB({ ...mockRenderedPage, page_index: 2, png_path: "/tmp/lit-pdf-test/page_2.png" });

    await waitFor(() => {
      expect((screen.getByTestId("pdf-page-image") as HTMLImageElement).src).toContain("page_2.png");
    });
    fireEvent.load(screen.getByTestId("pdf-page-image"));

    await waitFor(() => {
      expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(2);
    });
  });

  it("keeps the spinner after the render IPC resolves until the new image paints (#456)", async () => {
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
    fireEvent.load(screen.getByTestId("pdf-page-image"));

    // Default mock resolves pdf_render_page immediately — the spinner must
    // still appear, because the swapped-in image has not painted yet.
    goToPage!(1);

    await waitFor(() => {
      expect((screen.getByTestId("pdf-page-image") as HTMLImageElement).src).toContain("page_1.png");
    });
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-loading")).toBeInTheDocument();
    });

    fireEvent.load(screen.getByTestId("pdf-page-image"));

    await waitFor(() => {
      expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
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
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();
    fireEvent.load(screen.getByTestId("pdf-page-image"));

    let resolveRender!: (v: unknown) => void;
    const deferred = new Promise((r) => { resolveRender = r; });
    mockInvoke((cmd) => {
      if (cmd === "pdf_render_page") return deferred;
      if (cmd === "pdf_prefetch") return null;
      if (cmd === "pdf_close") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    await act(async () => {
      goToPage!(1);
    });

    // Transition started, but the grace timer has not fired yet.
    expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-loading")).toBeInTheDocument();
    });

    resolveRender({ ...mockRenderedPage, page_index: 1, png_path: "/tmp/lit-pdf-test/page_1.png" });
  });

  it("clears the spinner when the new image fails to load", async () => {
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
    fireEvent.load(screen.getByTestId("pdf-page-image"));

    goToPage!(1);

    await waitFor(() => {
      expect((screen.getByTestId("pdf-page-image") as HTMLImageElement).src).toContain("page_1.png");
    });
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-loading")).toBeInTheDocument();
    });

    fireEvent.error(screen.getByTestId("pdf-page-image"));

    await waitFor(() => {
      expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
    });
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
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(goToPage).not.toBeNull();
    fireEvent.load(screen.getByTestId("pdf-page-image"));

    goToPage!(1);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-loading")).toBeInTheDocument();
    });

    const overlay = screen.getByTestId("pdf-page-loading");
    expect(overlay.parentElement).toBe(screen.getByTestId("pdf-viewer"));
    expect(overlay.parentElement!.className).not.toContain("overflow-auto");
  });

  it("does not flash the overlay spinner after the initial Loading PDF screen disappears", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    // Wait for the initial render to complete (exits the "Loading PDF…" screen).
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    // Do NOT fire onLoad — simulates a slow browser decode of the first PNG.
    // Wait well past the spinner grace period (150ms) with real timers.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    // The overlay spinner must NOT appear — this is the first decode after the
    // "Loading PDF…" screen, not a page-to-page navigation.
    expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();

    // Now let the image paint.
    fireEvent.load(screen.getByTestId("pdf-page-image"));
  });

  it("calls registerZoomHandlers with zoomIn/zoomOut/zoomReset", async () => {
    const registerZoomHandlers = vi.fn();
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerZoomHandlers={registerZoomHandlers}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    expect(registerZoomHandlers).toHaveBeenCalled();
    const handlers = registerZoomHandlers.mock.calls[0]![0];
    expect(typeof handlers.zoomIn).toBe("function");
    expect(typeof handlers.zoomOut).toBe("function");
    expect(typeof handlers.zoomReset).toBe("function");
  });

  it("zoomIn from registerZoomHandlers re-renders at higher DPI", async () => {
    let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerZoomHandlers={(h) => { zoomHandlers = h; }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(zoomHandlers).not.toBeNull();

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    zoomHandlers!.zoomIn();

    await waitFor(() => {
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls.length).toBeGreaterThanOrEqual(1);
      // 1.1x zoom at dpr=1: Math.round(144 * 1 * 1.1) = 158
      expect(renderCalls[0]![1]).toEqual(expect.objectContaining({ dpi: 158 }));
    });
  });

  it("zoomOut from registerZoomHandlers re-renders at lower DPI", async () => {
    let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerZoomHandlers={(h) => { zoomHandlers = h; }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(zoomHandlers).not.toBeNull();

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    // Zoom out from default 1.0x -> 0.9x: Math.round(144 * 1 * 0.9) = 130
    zoomHandlers!.zoomOut();

    await waitFor(() => {
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls.length).toBeGreaterThanOrEqual(1);
      expect(renderCalls[0]![1]).toEqual(expect.objectContaining({ dpi: 130 }));
    });
  });

  it("zoomReset from registerZoomHandlers resets to default DPI", async () => {
    let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
    const onPageChange = vi.fn();
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerZoomHandlers={(h) => { zoomHandlers = h; }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(zoomHandlers).not.toBeNull();

    const { invoke } = await import("@tauri-apps/api/core");

    // Zoom out twice: 1.0 -> 0.9 -> 0.8
    zoomHandlers!.zoomOut();
    await waitFor(() => {
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls.some((c: unknown[]) => (c[1] as Record<string, unknown>).dpi === 130)).toBe(true);
    });
    zoomHandlers!.zoomOut();
    await waitFor(() => {
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls.some((c: unknown[]) => (c[1] as Record<string, unknown>).dpi === 115)).toBe(true);
    });

    // Reset zoom
    zoomHandlers!.zoomReset();

    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    // Navigate to page 1 -- should render at default DPI (144), not 0.8x (115)
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "j" });
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page");
    expect(renderCalls.length).toBeGreaterThanOrEqual(1);
    expect(renderCalls[0]![1]).toEqual(expect.objectContaining({ dpi: 144, pageIndex: 1 }));
  });

  it("zoom is clamped at max (no-op at highest level)", async () => {
    let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerZoomHandlers={(h) => { zoomHandlers = h; }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(zoomHandlers).not.toBeNull();

    const { invoke } = await import("@tauri-apps/api/core");

    // Zoom in 7 times to reach max (index 5 -> 12, which is 3.0x)
    for (let i = 0; i < 7; i++) {
      zoomHandlers!.zoomIn();
      await waitFor(() => {
        const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
          .filter((c: unknown[]) => c[0] === "pdf_render_page");
        expect(renderCalls.length).toBeGreaterThanOrEqual(i + 2); // +1 for initial, +1 for this zoom
      });
    }

    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    // One more zoom in should be a no-op
    zoomHandlers!.zoomIn();

    await Promise.resolve();
    const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page");
    expect(renderCalls).toHaveLength(0);
  });

  it("zoom is clamped at min (no-op at lowest level)", async () => {
    let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerZoomHandlers={(h) => { zoomHandlers = h; }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(zoomHandlers).not.toBeNull();

    const { invoke } = await import("@tauri-apps/api/core");

    // Zoom out 5 times to reach min (index 5 -> 0, which is 0.5x)
    for (let i = 0; i < 5; i++) {
      zoomHandlers!.zoomOut();
      await waitFor(() => {
        const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
          .filter((c: unknown[]) => c[0] === "pdf_render_page");
        expect(renderCalls.length).toBeGreaterThanOrEqual(i + 2);
      });
    }

    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    // One more zoom out should be a no-op
    zoomHandlers!.zoomOut();

    await Promise.resolve();
    const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page");
    expect(renderCalls).toHaveLength(0);
  });

  it("page navigation after zoom uses the zoomed DPI", async () => {
    let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
    const onPageChange = vi.fn();
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerZoomHandlers={(h) => { zoomHandlers = h; }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(zoomHandlers).not.toBeNull();

    const { invoke } = await import("@tauri-apps/api/core");

    // Zoom in once (1.0 -> 1.1)
    zoomHandlers!.zoomIn();
    await waitFor(() => {
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls.some((c: unknown[]) => (c[1] as Record<string, unknown>).dpi === 158)).toBe(true);
    });

    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    // Navigate to next page
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "j" });

    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page");
    expect(renderCalls.length).toBeGreaterThanOrEqual(1);
    expect(renderCalls[0]![1]).toEqual(expect.objectContaining({ dpi: 158, pageIndex: 1 }));
  });

  it("file change resets zoom to default", async () => {
    let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
    const { rerender } = render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerZoomHandlers={(h) => { zoomHandlers = h; }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(zoomHandlers).not.toBeNull();

    // Zoom in via callback
    zoomHandlers!.zoomIn();
    const { invoke } = await import("@tauri-apps/api/core");
    await waitFor(() => {
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls.some((c: unknown[]) => (c[1] as Record<string, unknown>).dpi === 158)).toBe(true);
    });

    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    // Switch to a different file
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "pdf_open":
          return { page_count: 2, path: "/test/other.pdf" };
        case "pdf_render_page": {
          const a = args as Record<string, unknown>;
          const idx = a?.pageIndex ?? 0;
          return { ...mockRenderedPage, page_index: idx, png_path: `/tmp/lit-pdf-test/other_page_${idx}.png` };
        }
        case "pdf_prefetch":
          return null;
        case "pdf_close":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    rerender(
      <PdfViewer
        filePath="/test/other.pdf"
        paneId="pane-1"
        registerZoomHandlers={(h) => { zoomHandlers = h; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    // The new file should have been rendered at default DPI (144), not zoomed DPI (158)
    const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page");
    expect(renderCalls.length).toBeGreaterThanOrEqual(1);
    expect(renderCalls[0]![1]).toEqual(expect.objectContaining({ dpi: 144 }));
  });

  it("does not flash the overlay spinner after a file-change Loading PDF screen disappears", async () => {
    const { rerender } = render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    // Wait for the initial load, then paint.
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    fireEvent.load(screen.getByTestId("pdf-page-image"));

    // Switch to a new file. The mock resolves immediately so the new file's
    // first page will render right away.
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "pdf_open":
          return { page_count: 2, path: "/test/other.pdf" };
        case "pdf_render_page": {
          const a = args as Record<string, unknown>;
          const idx = a?.pageIndex ?? 0;
          return { ...mockRenderedPage, page_index: idx, png_path: `/tmp/lit-pdf-test/other_page_${idx}.png` };
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

    // Wait for the new file's image to appear.
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
      expect((screen.getByTestId("pdf-page-image") as HTMLImageElement).src).toContain("other_page_0");
    });

    // Do NOT fire onLoad — simulates slow decode of the new file's first PNG.
    // Wait well past the spinner grace period (150ms) with real timers.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    // The overlay spinner must NOT appear — this is the first decode after a
    // file-change "Loading PDF…" screen, not a page navigation.
    expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();

    fireEvent.load(screen.getByTestId("pdf-page-image"));
  });

  it("zoom during slow page navigation still fires onPageChange for the new page", async () => {
    let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
    const onPageChange = vi.fn();
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        onPageChange={onPageChange}
        registerZoomHandlers={(h) => { zoomHandlers = h; }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(zoomHandlers).not.toBeNull();

    // Make page 1 render slow at default DPI, but resolve immediately at zoom DPI.
    let resolveSlowRender!: (v: unknown) => void;
    const slowRender = new Promise((r) => { resolveSlowRender = r; });
    mockInvoke((cmd, args) => {
      if (cmd === "pdf_render_page") {
        const a = args as Record<string, unknown>;
        const idx = (a?.pageIndex ?? 0) as number;
        const dpi = (a?.dpi ?? 0) as number;
        // Default DPI (144) for page 1 is slow; zoomed DPI (158) resolves immediately.
        if (idx === 1 && dpi === 144) return slowRender;
        return { ...mockRenderedPage, page_index: idx, png_path: `/tmp/lit-pdf-test/page_${idx}.png` };
      }
      if (cmd === "pdf_prefetch") return null;
      if (cmd === "pdf_close") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    // Navigate to page 1 (slow render in flight).
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "j" });

    // Zoom in while page 1 render is pending via registered callback.
    zoomHandlers!.zoomIn();

    // onPageChange(1) must fire even though the original goToPage render
    // was superseded -- the zoom rendered page 1 successfully.
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    // Clean up the deferred slow render.
    resolveSlowRender({ ...mockRenderedPage, page_index: 1, png_path: "/tmp/lit-pdf-test/page_1.png" });
  });

  it("applies maxWidth:100% at default zoom so wide pages fit the container", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.style.maxWidth).toBe("100%");
    });
  });

  it("removes maxWidth constraint when zoomed in beyond 1x", async () => {
    let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerZoomHandlers={(h) => { zoomHandlers = h; }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(zoomHandlers).not.toBeNull();

    zoomHandlers!.zoomIn();

    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.style.maxWidth).toBe("");
    });
  });

  it("restores maxWidth:100% when zooming back to 1x from above", async () => {
    let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerZoomHandlers={(h) => { zoomHandlers = h; }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(zoomHandlers).not.toBeNull();

    // Zoom in to 1.1x
    zoomHandlers!.zoomIn();
    const { invoke } = await import("@tauri-apps/api/core");
    await waitFor(() => {
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls.some((c: unknown[]) => (c[1] as Record<string, unknown>).dpi === 158)).toBe(true);
    });

    // Zoom back to 1.0x
    zoomHandlers!.zoomOut();
    await waitFor(() => {
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls.some((c: unknown[]) => (c[1] as Record<string, unknown>).dpi === 144)).toBe(true);
    });

    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.style.maxWidth).toBe("100%");
    });
  });

  it("clears spinner when a cache-hit zoom supersedes a slow in-flight zoom render", async () => {
    let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerZoomHandlers={(h) => { zoomHandlers = h; }}
      />,
    );

    // 1. Wait for initial load (page 0 at DPI 144 is cached) and paint it.
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    fireEvent.load(screen.getByTestId("pdf-page-image"));
    expect(zoomHandlers).not.toBeNull();

    // 2. Zoom in once: index 5 -> 6, DPI = Math.round(144*1.1) = 158.
    //    Resolves immediately via default mock, caching page 0 at DPI 158.
    zoomHandlers!.zoomIn();
    const { invoke } = await import("@tauri-apps/api/core");
    await waitFor(() => {
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls.some((c: unknown[]) => (c[1] as Record<string, unknown>).dpi === 158)).toBe(true);
    });
    // Paint the zoomed image so loadedSrc is up to date.
    fireEvent.load(screen.getByTestId("pdf-page-image"));

    // 3. Swap mock to return a deferred (never-resolving) promise for renders.
    let resolveDeferred!: (v: unknown) => void;
    const deferred = new Promise((r) => { resolveDeferred = r; });
    mockInvoke((cmd) => {
      if (cmd === "pdf_render_page") return deferred;
      if (cmd === "pdf_prefetch") return null;
      if (cmd === "pdf_close") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    // 4. Zoom in again: index 6 -> 7, DPI = Math.round(144*1.25) = 180.
    //    Cache miss -- slow render in flight, pageLoading=true.
    zoomHandlers!.zoomIn();

    // Wait for the spinner to appear (past grace period).
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-loading")).toBeInTheDocument();
    });

    // 5. Zoom back out: index 7 -> 6, DPI 158 -- cache hit from step 2.
    zoomHandlers!.zoomOut();
    // Paint the (already-known) cached image.
    fireEvent.load(screen.getByTestId("pdf-page-image"));

    // 6. Wait past the grace period; the spinner must NOT be stuck.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();

    // Clean up: resolve the deferred so no dangling promise warnings.
    resolveDeferred({ ...mockRenderedPage, page_index: 0, png_path: "/tmp/lit-pdf-test/page_0.png" });
  });

  it("file change restores maxWidth:100% after being zoomed beyond 1x", async () => {
    let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
    const { rerender } = render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerZoomHandlers={(h) => { zoomHandlers = h; }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });
    expect(zoomHandlers).not.toBeNull();

    // Zoom in to 1.1x (beyond 1.0x -- maxWidth should be removed).
    zoomHandlers!.zoomIn();
    const { invoke } = await import("@tauri-apps/api/core");
    await waitFor(() => {
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls.some((c: unknown[]) => (c[1] as Record<string, unknown>).dpi === 158)).toBe(true);
    });
    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.style.maxWidth).toBe("");
    });

    // Switch to a different file -- zoom should reset to default (1.0x) and
    // maxWidth should be back to "100%".
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "pdf_open":
          return { page_count: 2, path: "/test/other.pdf" };
        case "pdf_render_page": {
          const a = args as Record<string, unknown>;
          const idx = a?.pageIndex ?? 0;
          return { ...mockRenderedPage, page_index: idx, png_path: `/tmp/lit-pdf-test/other_page_${idx}.png` };
        }
        case "pdf_prefetch":
          return null;
        case "pdf_close":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    rerender(
      <PdfViewer
        filePath="/test/other.pdf"
        paneId="pane-1"
        registerZoomHandlers={(h) => { zoomHandlers = h; }}
      />,
    );

    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.src).toContain("other_page_0");
      expect(img.style.maxWidth).toBe("100%");
    });
  });

  it("rapid multi-step zoom coalesces into a single render at the final DPI", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
      render(
        <PdfViewer
          filePath="/test/doc.pdf"
          paneId="pane-1"
          registerZoomHandlers={(h) => { zoomHandlers = h; }}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
      });
      expect(zoomHandlers).not.toBeNull();

      const { invoke } = await import("@tauri-apps/api/core");
      (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

      // Fire 5 rapid zoomIn calls with no timer advancement between them.
      // Default index is 5; after 5 calls: 6,7,8,9,10 (zoom 2.0x).
      await act(async () => {
        for (let i = 0; i < 5; i++) {
          zoomHandlers!.zoomIn();
        }
      });

      // Before the debounce fires, no renders should have been dispatched.
      const renderCallsBefore = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCallsBefore).toHaveLength(0);

      // Advance past the debounce delay and flush resulting microtasks.
      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      await waitFor(() => {
        const renderCallsAfter = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
          .filter((c: unknown[]) => c[0] === "pdf_render_page");
        // Exactly 1 render for the final zoom level.
        expect(renderCallsAfter).toHaveLength(1);
        // Zoom index 10 = 2.0x, DPI = Math.round(144 * 2.0) = 288
        expect(renderCallsAfter[0]![1]).toEqual(expect.objectContaining({ dpi: 288 }));
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("page navigation (j/k) is NOT debounced -- renders immediately", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
      });

      const { invoke } = await import("@tauri-apps/api/core");
      (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

      // Press j to go to next page.
      await act(async () => {
        fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "j" });
      });

      // The render should happen immediately (no debounce), before advancing timers.
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls.length).toBeGreaterThanOrEqual(1);
      expect(renderCalls[0]![1]).toEqual(expect.objectContaining({ pageIndex: 1 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("zoom debounce timer is cleared on file change", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
      const { rerender } = render(
        <PdfViewer
          filePath="/test/doc.pdf"
          paneId="pane-1"
          registerZoomHandlers={(h) => { zoomHandlers = h; }}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
      });
      expect(zoomHandlers).not.toBeNull();

      // Fire a zoom-in (starts debounce timer).
      await act(async () => {
        zoomHandlers!.zoomIn();
      });

      // Switch to a different file before the debounce fires.
      mockInvoke((cmd, args) => {
        switch (cmd) {
          case "pdf_open":
            return { page_count: 2, path: "/test/other.pdf" };
          case "pdf_render_page": {
            const a = args as Record<string, unknown>;
            const idx = a?.pageIndex ?? 0;
            return { ...mockRenderedPage, page_index: idx, png_path: `/tmp/lit-pdf-test/other_page_${idx}.png` };
          }
          case "pdf_prefetch":
            return null;
          case "pdf_close":
            return null;
          default:
            throw new Error(`Unknown command: ${cmd}`);
        }
      });

      await act(async () => {
        rerender(
          <PdfViewer
            filePath="/test/other.pdf"
            paneId="pane-1"
            registerZoomHandlers={(h) => { zoomHandlers = h; }}
          />,
        );
      });

      // Advance past debounce delay + flush.
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      await waitFor(() => {
        expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
      });

      const { invoke } = await import("@tauri-apps/api/core");
      // After the file change, renders should only be at default DPI (144)
      // for the new file, not at the zoomed DPI (158) from the stale timer.
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      const allDpis = renderCalls.map((c: unknown[]) => (c[1] as Record<string, unknown>).dpi);
      // The last render(s) should all be at default DPI 144 (the new file).
      const lastDpi = allDpis[allDpis.length - 1];
      expect(lastDpi).toBe(144);
      // There should be no DPI-158 renders after the file change triggered
      // a new DPI-144 render sequence.
      const indexOfFirstDefault = allDpis.indexOf(144);
      const dpisAfterFileChange = allDpis.slice(indexOfFirstDefault);
      expect(dpisAfterFileChange.every((d: unknown) => d === 144)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("getEffectiveDpi clamps to MAX_EFFECTIVE_DPI on high-DPR devices at max zoom", async () => {
    // Simulate dpr=2 (retina display).
    Object.defineProperty(window, "devicePixelRatio", { writable: true, value: 2 });

    const allDpis: number[] = [];
    mockInvoke((cmd, args) => {
      if (cmd === "pdf_render_page") {
        const a = args as Record<string, unknown>;
        const dpi = a?.dpi as number;
        allDpis.push(dpi);
        const idx = (a?.pageIndex ?? 0) as number;
        return { ...mockRenderedPage, page_index: idx, png_path: `/tmp/lit-pdf-test/page_${idx}.png` };
      }
      if (cmd === "pdf_open") return mockPdfInfo;
      if (cmd === "pdf_prefetch") return null;
      if (cmd === "pdf_close") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let zoomHandlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } | null = null;
      render(
        <PdfViewer
          filePath="/test/doc.pdf"
          paneId="pane-1"
          registerZoomHandlers={(h) => { zoomHandlers = h; }}
        />,
      );
      await waitFor(() => {
        expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
      });
      expect(zoomHandlers).not.toBeNull();

      // Zoom to max (3.0x) by calling zoomIn 7 times (index 5 -> 12).
      // Rapid calls are debounced, so fire them all then advance timers.
      await act(async () => {
        for (let i = 0; i < 7; i++) {
          zoomHandlers!.zoomIn();
        }
      });

      // Advance past the debounce delay and flush.
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      await waitFor(() => {
        // At least the initial render + the debounced zoom render
        expect(allDpis.length).toBeGreaterThanOrEqual(2);
      });

      // At dpr=2 and zoom=3.0x, unclamped DPI would be 864. All DPI values
      // passed to the backend should be <= MAX_EFFECTIVE_DPI (600).
      for (const dpi of allDpis) {
        expect(dpi).toBeLessThanOrEqual(600);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
