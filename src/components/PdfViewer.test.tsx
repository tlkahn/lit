import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.src).toContain("asset://localhost/");
      expect(img.src).not.toContain("data:image/png;base64");
    });
  });

  it("shows page indicator", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      const indicator = screen.getByTestId("pdf-page-indicator");
      expect(indicator.textContent).toBe("Page 1 / 3");
    });
  });

  it("next button navigates to page 2", async () => {
    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    await user.click(screen.getByTestId("pdf-next"));

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 2 / 3");
    });
  });

  it("prev disabled on page 1, next disabled on last page", async () => {
    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator")).toBeInTheDocument();
    });

    expect(screen.getByTestId("pdf-prev")).toBeDisabled();
    expect(screen.getByTestId("pdf-next")).not.toBeDisabled();

    // Navigate to last page
    await user.click(screen.getByTestId("pdf-next"));
    await user.click(screen.getByTestId("pdf-next"));

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 3 / 3");
    });

    expect(screen.getByTestId("pdf-next")).toBeDisabled();
    expect(screen.getByTestId("pdf-prev")).not.toBeDisabled();
  });

  it("calls pdfOpen on mount and pdfClose on unmount", async () => {
    const { unmount } = render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("pdf_open", { path: "/test/doc.pdf" });

    unmount();

    expect(invoke).toHaveBeenCalledWith("pdf_close");
  });

  it("shows loading state initially", () => {
    render(<PdfViewer filePath="/test/doc.pdf" />);
    expect(screen.getByTestId("pdf-loading")).toBeInTheDocument();
  });

  it("shows error state on failure", async () => {
    mockInvoke((cmd) => {
      if (cmd === "pdf_open") throw new Error("Failed to open PDF");
      if (cmd === "pdf_close") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<PdfViewer filePath="/bad/doc.pdf" />);

    await waitFor(() => {
      const error = screen.getByTestId("pdf-error");
      expect(error).toBeInTheDocument();
      expect(error.textContent).toContain("Failed to open PDF");
    });
  });

  it("passes DPI = 144 × devicePixelRatio to pdfRenderPage", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2 });
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("pdf_render_page", {
      pageIndex: 0,
      dpi: 288,
    });
  });

  it("sets CSS width to rendered.width / devicePixelRatio", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2 });
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.style.width).toBe("612px");
    });
  });

  it("serves cached page without re-invoking pdf_render_page", async () => {
    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    const { invoke } = await import("@tauri-apps/api/core");

    await user.click(screen.getByTestId("pdf-next"));
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 2 / 3");
    });

    const callsBefore = (invoke as unknown as ReturnType<typeof import("vitest").vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page").length;

    await user.click(screen.getByTestId("pdf-prev"));
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    const callsAfter = (invoke as unknown as ReturnType<typeof import("vitest").vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page").length;

    expect(callsAfter).toBe(callsBefore);
  });

  it("clears cache when filePath changes", async () => {
    const { rerender } = render(<PdfViewer filePath="/test/doc.pdf" />);

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

    rerender(<PdfViewer filePath="/test/other.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    expect(invoke).toHaveBeenCalledWith("pdf_render_page", expect.objectContaining({ pageIndex: 0 }));
  });

  it("prefetches adjacent pages after rendering current page", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" />);

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
    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

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

    await user.click(screen.getByTestId("pdf-next"));
    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.alt).toBe("Page 2");
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
    render(<PdfViewer filePath="/test/doc.pdf" />);
    const loading = screen.getByTestId("pdf-loading");
    expect(loading.querySelector("svg")).toBeInTheDocument();
    expect(loading.textContent).toContain("Loading PDF…");
  });

  it("shows spinner overlay during page navigation (cache miss)", async () => {
    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    let resolveRender!: (v: unknown) => void;
    const deferred = new Promise((r) => {
      resolveRender = r;
    });
    mockInvoke((cmd) => {
      if (cmd === "pdf_render_page") return deferred;
      if (cmd === "pdf_prefetch") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    await user.click(screen.getByTestId("pdf-next"));

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
    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    await user.click(screen.getByTestId("pdf-next"));
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 2 / 3");
    });

    await user.click(screen.getByTestId("pdf-prev"));
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    expect(screen.queryByTestId("pdf-page-loading")).not.toBeInTheDocument();
  });

  it("hides spinner overlay when page render fails", async () => {
    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    mockInvoke((cmd) => {
      if (cmd === "pdf_render_page") throw new Error("render failed");
      if (cmd === "pdf_prefetch") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    await user.click(screen.getByTestId("pdf-next"));

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

    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/big.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 8");
    });

    for (let i = 0; i < 6; i++) {
      await user.click(screen.getByTestId("pdf-next"));
      await waitFor(() => {
        const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
        expect(img.alt).toBe(`Page ${i + 2}`);
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
      await user.click(screen.getByTestId("pdf-prev"));
      await waitFor(() => {
        const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
        expect(img.alt).toBe(`Page ${i + 1}`);
      });
    }

    const renderCalls = (invoke as unknown as ReturnType<typeof import("vitest").vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page");
    expect(renderCalls.length).toBeGreaterThan(0);
  });

  describe("click debounce", () => {
    const bigPdfInfo = { page_count: 10, path: "/test/big.pdf" };

    beforeEach(() => {
      vi.useFakeTimers();
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
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("rapid clicks trigger only one render call for the final page", async () => {
      render(<PdfViewer filePath="/test/big.pdf" />);
      await act(async () => { await vi.runAllTimersAsync(); });

      const { invoke } = await import("@tauri-apps/api/core");
      (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

      const next = screen.getByTestId("pdf-next");
      fireEvent.click(next);
      fireEvent.click(next);
      fireEvent.click(next);

      let renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls).toHaveLength(0);

      await act(async () => { await vi.advanceTimersByTimeAsync(200); });

      renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls).toHaveLength(1);
      expect(renderCalls[0]![1]).toEqual(expect.objectContaining({ pageIndex: 3 }));
    });

    it("page indicator updates optimistically on every click", async () => {
      render(<PdfViewer filePath="/test/big.pdf" />);
      await act(async () => { await vi.runAllTimersAsync(); });

      const next = screen.getByTestId("pdf-next");
      fireEvent.click(next);
      fireEvent.click(next);
      fireEvent.click(next);

      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 4 / 10");
    });

    it("single click renders after debounce delay", async () => {
      render(<PdfViewer filePath="/test/big.pdf" />);
      await act(async () => { await vi.runAllTimersAsync(); });

      const { invoke } = await import("@tauri-apps/api/core");
      (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

      fireEvent.click(screen.getByTestId("pdf-next"));

      let renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls).toHaveLength(0);

      await act(async () => { await vi.advanceTimersByTimeAsync(200); });

      renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls).toHaveLength(1);
      expect(renderCalls[0]![1]).toEqual(expect.objectContaining({ pageIndex: 1 }));
    });

    it("cache hit renders immediately without debounce", async () => {
      render(<PdfViewer filePath="/test/big.pdf" />);
      await act(async () => { await vi.runAllTimersAsync(); });

      fireEvent.click(screen.getByTestId("pdf-next"));
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });

      const { invoke } = await import("@tauri-apps/api/core");
      (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

      fireEvent.click(screen.getByTestId("pdf-prev"));

      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 10");

      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls).toHaveLength(0);
    });

    it("cache hit during rapid clicks clears debounce timer", async () => {
      render(<PdfViewer filePath="/test/big.pdf" />);
      await act(async () => { await vi.runAllTimersAsync(); });

      fireEvent.click(screen.getByTestId("pdf-next"));
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      fireEvent.click(screen.getByTestId("pdf-next"));
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });

      const { invoke } = await import("@tauri-apps/api/core");
      (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

      fireEvent.click(screen.getByTestId("pdf-next"));
      fireEvent.click(screen.getByTestId("pdf-prev"));

      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 3 / 10");

      await act(async () => { await vi.advanceTimersByTimeAsync(200); });

      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      expect(renderCalls).toHaveLength(0);
    });

    it("debounce timer cleared on filePath change", async () => {
      const { rerender } = render(<PdfViewer filePath="/test/big.pdf" />);
      await act(async () => { await vi.runAllTimersAsync(); });

      const { invoke } = await import("@tauri-apps/api/core");
      (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

      fireEvent.click(screen.getByTestId("pdf-next"));

      mockInvoke((cmd, args) => {
        switch (cmd) {
          case "pdf_open":
            return { page_count: 5, path: "/test/other.pdf" };
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
      rerender(<PdfViewer filePath="/test/other.pdf" />);

      await act(async () => { await vi.runAllTimersAsync(); });

      const renderCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === "pdf_render_page");
      const pageIndices = renderCalls.map(
        (c: unknown[]) => (c[1] as Record<string, unknown>).pageIndex
      );
      expect(pageIndices).not.toContain(1);
    });
  });
});
