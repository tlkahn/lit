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

  it("Cmd+= zooms in and re-renders at higher DPI", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });

    await waitFor(() => {
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls.length).toBeGreaterThanOrEqual(1);
      // 1.1x zoom at dpr=1: Math.round(144 * 1 * 1.1) = 158
      expect(renderCalls[0]![1]).toEqual(expect.objectContaining({ dpi: 158 }));
    });
  });

  it("Cmd+- zooms out and re-renders at lower DPI", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    // Zoom out from default 1.0x → 0.9x: Math.round(144 * 1 * 0.9) = 130
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "-", metaKey: true });

    await waitFor(() => {
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls.length).toBeGreaterThanOrEqual(1);
      expect(renderCalls[0]![1]).toEqual(expect.objectContaining({ dpi: 130 }));
    });
  });

  it("Cmd+0 resets zoom to default DPI", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");

    // Zoom out twice: 1.0 → 0.9 → 0.8
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "-", metaKey: true });
    await waitFor(() => {
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls.some((c: unknown[]) => (c[1] as Record<string, unknown>).dpi === 130)).toBe(true);
    });
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "-", metaKey: true });
    await waitFor(() => {
      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      // 0.8x: Math.round(144 * 0.8) = 115
      expect(renderCalls.some((c: unknown[]) => (c[1] as Record<string, unknown>).dpi === 115)).toBe(true);
    });

    // Reset with Cmd+0 (1.0x / DPI 144 is cached from initial render, so
    // verify the reset took effect by navigating to a new page afterwards).
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "0", metaKey: true });

    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    // Navigate to page 1 — should render at default DPI (144), not 0.8x (115)
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
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");

    // Zoom in 7 times to reach max (index 5 → 12, which is 3.0x)
    for (let i = 0; i < 7; i++) {
      fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });
      await waitFor(() => {
        const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
          .filter((c: unknown[]) => c[0] === "pdf_render_page");
        expect(renderCalls.length).toBeGreaterThanOrEqual(i + 2); // +1 for initial, +1 for this zoom
      });
    }

    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    // One more zoom in should be a no-op
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });

    await Promise.resolve();
    const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page");
    expect(renderCalls).toHaveLength(0);
  });

  it("zoom is clamped at min (no-op at lowest level)", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");

    // Zoom out 5 times to reach min (index 5 → 0, which is 0.5x)
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "-", metaKey: true });
      await waitFor(() => {
        const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
          .filter((c: unknown[]) => c[0] === "pdf_render_page");
        expect(renderCalls.length).toBeGreaterThanOrEqual(i + 2);
      });
    }

    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    // One more zoom out should be a no-op
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "-", metaKey: true });

    await Promise.resolve();
    const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page");
    expect(renderCalls).toHaveLength(0);
  });

  it("page navigation after zoom uses the zoomed DPI", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");

    // Zoom in once (1.0 → 1.1)
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });
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
    const { rerender } = render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    // Zoom in
    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "=", metaKey: true });
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

    rerender(<PdfViewer filePath="/test/other.pdf" paneId="pane-1" />);

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
});
