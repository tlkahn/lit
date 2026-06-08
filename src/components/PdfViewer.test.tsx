import { describe, it, expect, beforeEach, vi } from "vitest";
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
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.src).toContain("asset://localhost/");
      expect(img.src).not.toContain("data:image/png;base64");
    });
  });

  it("shows page indicator", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

    await waitFor(() => {
      const indicator = screen.getByTestId("pdf-page-indicator");
      expect(indicator.textContent).toBe("Page 1 / 3");
    });
  });

  it("next button navigates to page 2", async () => {
    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

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
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

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
    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

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
    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

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
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 2 / 3");
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
    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

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
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

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
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);

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
    render(<PdfViewer filePath="/test/big.pdf" paneId="pane-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 8");
    });

    for (let i = 0; i < 6; i++) {
      await user.click(screen.getByTestId("pdf-next"));
      await waitFor(() => {
        expect(screen.getByTestId("pdf-page-indicator").textContent).toBe(`Page ${i + 2} / 8`);
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
        expect(screen.getByTestId("pdf-page-indicator").textContent).toBe(`Page ${i + 1} / 8`);
      });
    }

    const renderCalls = (invoke as unknown as ReturnType<typeof import("vitest").vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page");
    expect(renderCalls.length).toBeGreaterThan(0);
  });

  it("J navigates to the next page", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "j" });

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 2 / 3");
    });
  });

  it("advances two pages on a rapid double key-press without dropping one", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    // Fire two keydown events back-to-back WITHOUT awaiting a re-render between
    // them. The default mock resolves renders synchronously, so currentPageRef
    // updates synchronously while the React `currentPage` state commit is
    // batched — the exact condition that drops every other press when the
    // handler reads stale state instead of the ref.
    const viewer = screen.getByTestId("pdf-viewer");
    fireEvent.keyDown(viewer, { key: "j" });
    fireEvent.keyDown(viewer, { key: "j" });

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 3 / 3");
    });

    // The two presses must net to a two-page advance: onPageChange fires with
    // the final target (2). Before the fix the second press was dropped by the
    // ref guard and the viewer stalled on Page 2 / 3 (index 1).
    const pageChanges = onPageChange.mock.calls.map((c) => c[0]);
    expect(pageChanges).toContain(2);
  });

  it("advances two pages on a rapid Next-button double-click without dropping one", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    // Fire two clicks back-to-back WITHOUT awaiting a re-render between them
    // (userEvent.click would await microtasks and let the batched state commit
    // flush, masking the bug). The default mock resolves renders synchronously,
    // so currentPageRef updates synchronously while the React `currentPage`
    // state commit is batched — the exact condition that drops every other
    // click when the handler reads stale state instead of the ref.
    const next = screen.getByTestId("pdf-next");
    fireEvent.click(next);
    fireEvent.click(next);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 3 / 3");
    });

    // The two clicks must net to a two-page advance: onPageChange fires with the
    // final target (2). Before the fix the second click read stale currentPage
    // and recomputed the same target the first click already advanced the ref
    // to, so the ref guard dropped it and the viewer stalled on Page 2 / 3.
    const pageChanges = onPageChange.mock.calls.map((c) => c[0]);
    expect(pageChanges).toContain(2);
  });

  it("ArrowRight navigates to the next page", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "ArrowRight" });

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 2 / 3");
    });
  });

  it("K on the first page is a no-op", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    const { invoke } = await import("@tauri-apps/api/core");
    const before = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page").length;

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "k" });

    expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    const after = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page").length;
    expect(after).toBe(before);
  });

  it("J on the last page is a no-op", async () => {
    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    await user.click(screen.getByTestId("pdf-next"));
    await user.click(screen.getByTestId("pdf-next"));
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 3 / 3");
    });

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "j" });
    expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 3 / 3");
  });

  it("fires onPageChange(0) exactly once after the initial page renders", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    // The mount effect must publish the initial page so the parent's status bar
    // and reverse sync are seeded. Before the fix it was never called with 0,
    // and the goToPage same-page guard prevented it from ever firing for page 0.
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(0);
    });

    // Pin the once-only contract: a regression where the mount effect re-runs
    // would fire onPageChange(0) more than once.
    const zeroCalls = onPageChange.mock.calls.filter((c) => c[0] === 0);
    expect(zeroCalls).toHaveLength(1);
  });

  it("calls onPageChange when the page changes", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewer filePath="/test/doc.pdf" paneId="pane-1" onPageChange={onPageChange} />);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    fireEvent.keyDown(screen.getByTestId("pdf-viewer"), { key: "j" });

    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });
  });

  it("ignores a `page` prop and does not navigate from it (imperative-only navigation)", async () => {
    // The controlled `page` prop was removed; navigation is driven exclusively
    // through the imperative registerGoToPage channel. A stray `page` prop must
    // be inert — it must not navigate the viewer.
    render(
      <PdfViewer filePath="/test/doc.pdf" paneId="pane-1" {...({ page: 2 } as unknown as Record<string, never>)} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    // Give any (now-removed) controlled effect a chance to misbehave.
    await Promise.resolve();

    const { invoke } = await import("@tauri-apps/api/core");
    const renderedPage2 = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "pdf_render_page")
      .some((c: unknown[]) => (c[1] as { pageIndex?: number })?.pageIndex === 2);

    expect(renderedPage2).toBe(false);
    expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
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
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
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
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });
    expect(goToPage).not.toBeNull();

    // Pre-warm the cache for page index 2 by jumping straight there (skipping
    // page index 1), so page 2 is cached but page 1 is NOT. Page 0 is already
    // cached from the initial load.
    goToPage!(2);
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 3 / 3");
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

    // Start a slow navigation to page index 1 (cache miss -> awaits IPC).
    goToPage!(1);
    // Immediately navigate to page index 0 (cache hit -> commits synchronously,
    // shows Page 1 / 3).
    goToPage!(0);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    // Now resolve the slow page-1 render. It is stale and must NOT revert us.
    resolveSlow({ ...mockRenderedPage, page_index: 1, png_path: "/tmp/lit-pdf-test/page_1.png" });

    // Give the resolved promise a chance to (incorrectly) commit.
    await Promise.resolve();
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });
    expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");

    const pageChanges = onPageChange.mock.calls.map((c) => c[0]);
    expect(pageChanges[pageChanges.length - 1]).toBe(0);
    expect(onPageChange).not.toHaveBeenCalledWith(1);
  });

  it("keeps spinner while a superseding cache-miss navigation is still rendering after a stale render resolves", async () => {
    let goToPage: ((i: number) => void) | null = null;
    render(
      <PdfViewer
        filePath="/test/doc.pdf"
        paneId="pane-1"
        registerGoToPage={(fn) => { goToPage = fn; }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
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
    expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 3 / 3");
  });
});
