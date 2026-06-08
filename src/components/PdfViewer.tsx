import { useEffect, useState, useCallback, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { pdfOpen, pdfRenderPage, pdfPrefetch, pdfClose, pdfCancelPrecache, pdfSeekPrecache } from "../lib/ipc";
import type { PdfInfo, RenderedPage } from "../lib/ipc";
import { SpinnerSvg } from "./SpinnerSvg";
import { usePdfZoom } from "../hooks/usePdfZoom";

const BASE_DPI = 144;

// Mirrors the Rust-side INITIAL_SYNC_PAGES: a navigation jump larger than this
// from the last precache anchor restarts the background spiral around the new
// target so far-away pages warm up instead of relying on adjacent prefetch.
const INITIAL_SYNC_PAGES = 10;

function getEffectiveDpi(): number {
  return Math.round(BASE_DPI * (window.devicePixelRatio || 1));
}

function cacheKey(pageIndex: number, dpi: number): string {
  return `${pageIndex}_${dpi}`;
}

// The Rust-side cache is the source of truth for precached pages; this frontend
// map only avoids redundant IPC for pages already fetched, so it is uncapped.
// Entries are small metadata ({page_index, png_path, width, height}); png_path is
// a file path, not image data, so the map stays trivially small even for large PDFs.
function cacheSet(cache: Map<string, RenderedPage>, key: string, value: RenderedPage) {
  cache.delete(key);
  cache.set(key, value);
}

function cacheGet(cache: Map<string, RenderedPage>, key: string): RenderedPage | undefined {
  const val = cache.get(key);
  if (val !== undefined) {
    cache.delete(key);
    cache.set(key, val);
  }
  return val;
}

interface PdfViewerProps {
  filePath: string;
  paneId: string;
  /**
   * Page to open on (0-based). When provided, the viewer opens anchored at this
   * page — it is forwarded to pdf_open as the precache anchor and shown first
   * instead of page 0. Omit (undefined) to open on page 0.
   */
  initialPage?: number;
  onPageChange?: (pageIndex: number) => void;
  /**
   * Publish this viewer's internal `goToPage` so an external owner (e.g. the
   * pane, for forward sync) can drive navigation imperatively. Called whenever
   * the callback identity changes so the always-current closure is registered.
   */
  registerGoToPage?: (fn: (pageIndex: number) => void) => void;
}

export function PdfViewer({ filePath, paneId, initialPage, onPageChange, registerGoToPage }: PdfViewerProps) {
  const [pdfInfo, setPdfInfo] = useState<PdfInfo | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage ?? 0);
  const [rendered, setRendered] = useState<RenderedPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const filePathRef = useRef(filePath);
  const currentPageRef = useRef(currentPage);
  const cacheRef = useRef(new Map<string, RenderedPage>());
  const navSeqRef = useRef(0);
  const zoomSeqRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const renderedZoomRef = useRef(1);
  const lastAnchorRef = useRef(initialPage ?? 0);
  // Keep an always-current ref to onPageChange so the mount effect can publish
  // the initial page without listing onPageChange as a dependency (which would
  // re-open the PDF and reset to page 0 on every callback identity change).
  const onPageChangeRef = useRef(onPageChange);
  useEffect(() => {
    onPageChangeRef.current = onPageChange;
  }, [onPageChange]);

  const prefetchAdjacent = useCallback((pageIndex: number, pageCount: number, dpi: number) => {
    if (pageIndex > 0) pdfPrefetch(pageIndex - 1, dpi, paneId).catch(() => {});
    if (pageIndex < pageCount - 1) pdfPrefetch(pageIndex + 1, dpi, paneId).catch(() => {});
  }, [paneId]);

  const renderSharp = useCallback(
    async (zoom: number) => {
      const mySeq = ++zoomSeqRef.current;
      const dpi = Math.round(getEffectiveDpi() * zoom);
      const page = currentPageRef.current;
      const key = cacheKey(page, dpi);
      try {
        const cached = cacheGet(cacheRef.current, key);
        const rp = cached ?? (await pdfRenderPage(page, dpi, paneId));
        if (filePathRef.current !== filePath) return;
        if (currentPageRef.current !== page) return;
        if (zoomSeqRef.current !== mySeq) return;
        if (!cached) cacheSet(cacheRef.current, key, rp);
        renderedZoomRef.current = zoom;
        setRendered(rp);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [filePath, paneId],
  );

  const ready = rendered !== null;
  const { zoomLevel, zoomLevelRef, resetZoom, handleZoomKey } = usePdfZoom({
    ready,
    scrollContainerRef,
    renderSharp,
  });

  const maybeSeekPrecache = useCallback((index: number, dpi: number) => {
    if (Math.abs(index - lastAnchorRef.current) > INITIAL_SYNC_PAGES) {
      lastAnchorRef.current = index;
      pdfSeekPrecache(paneId, index, dpi).catch(() => {});
    }
  }, [paneId]);

  useEffect(() => {
    filePathRef.current = filePath;
    cacheRef.current.clear();
    // A fresh document loads at base DPI and 100% zoom.
    renderedZoomRef.current = 1;
    resetZoom();
    let cancelled = false;

    (async () => {
      try {
        // Compute the DPI once so the same value keys the initial_pages cache
        // population, the page-0 display, and every later goToPage lookup.
        const dpi = getEffectiveDpi();
        const anchor = initialPage ?? 0;
        const result = await pdfOpen(filePath, paneId, dpi, initialPage);
        if (cancelled) return;
        setPdfInfo({ page_count: result.page_count, path: result.path });
        setCurrentPage(anchor);
        currentPageRef.current = anchor;
        lastAnchorRef.current = anchor;

        // Populate the frontend cache from the synchronously-rendered initial
        // batch so navigation across those pages is an in-memory hit.
        for (const p of result.initial_pages) {
          cacheSet(cacheRef.current, cacheKey(p.page_index, dpi), p);
        }

        // Show the anchor page: normally it is in initial_pages (backend renders
        // the batch around the anchor). Fall back to an on-demand render only if
        // the batch omitted it (e.g. a legacy/empty mock or a degenerate document).
        let anchorPage = cacheGet(cacheRef.current, cacheKey(anchor, dpi));
        if (!anchorPage) {
          anchorPage = await pdfRenderPage(anchor, dpi, paneId);
          if (cancelled) return;
          cacheSet(cacheRef.current, cacheKey(anchor, dpi), anchorPage);
        }
        setRendered(anchorPage);
        // Publish the initial page exactly once so the parent's status bar and
        // reverse sync are seeded. The goToPage same-page guard would otherwise
        // suppress this since currentPageRef is already at the anchor.
        onPageChangeRef.current?.(anchor);
        prefetchAdjacent(anchor, result.page_count, dpi);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      // Stop the background precache thread promptly before closing so no stale
      // progress events arrive after unmount. pdf_close also cancels defensively.
      pdfCancelPrecache(paneId).catch(() => {});
      pdfClose(paneId).catch(() => {});
    };
  }, [filePath, paneId, initialPage, prefetchAdjacent, resetZoom]);

  const goToPage = useCallback(
    async (index: number) => {
      if (index === currentPageRef.current) {
        console.log("[sync:pdf] goToPage(%d) BAIL — same page (currentPageRef=%d)", index, currentPageRef.current);
        return;
      }
      console.log("[sync:pdf] goToPage(%d) (was %d)", index, currentPageRef.current);
      // Monotonic navigation token: any newer navigation (even a synchronous
      // cache hit) supersedes an in-flight slow render so it cannot revert us.
      const mySeq = ++navSeqRef.current;
      // Advance the ref synchronously to the navigation target so a rapid
      // second key-press (which reads currentPageRef before this invocation's
      // awaited render commits) derives the *next* target instead of recomputing
      // this same one and getting dropped by the same-page guard above.
      currentPageRef.current = index;
      // goToPage always renders the target at base DPI (getEffectiveDpi(),
      // logical zoom = 1). Reset renderedZoomRef so cssScale = zoomLevel /
      // renderedZoom = zoomLevel: the freshly navigated base-DPI bitmap shows as
      // a pure CSS upscale at the current zoom instead of snapping to 100% (which
      // would happen if renderedZoom were left at the previous sharp value). A
      // corrective sharp re-render is scheduled below on each committed branch
      // since the usePdfZoom debounce does NOT re-fire on page navigation.
      renderedZoomRef.current = 1;
      try {
        const dpi = getEffectiveDpi();
        const key = cacheKey(index, dpi);
        const cached = cacheGet(cacheRef.current, key);
        if (cached && filePathRef.current === filePath) {
          setRendered(cached);
          setCurrentPage(index);
          // currentPageRef already set to index synchronously above.
          onPageChange?.(index);
          prefetchAdjacent(index, pdfInfo?.page_count ?? 0, dpi);
          if (zoomLevelRef.current !== 1) void renderSharp(zoomLevelRef.current);
          maybeSeekPrecache(index, dpi);
          return;
        }

        setPageLoading(true);
        try {
          const rp = await pdfRenderPage(index, dpi, paneId);
          if (filePathRef.current === filePath && navSeqRef.current === mySeq) {
            cacheSet(cacheRef.current, key, rp);
            setRendered(rp);
            setCurrentPage(index);
            currentPageRef.current = index;
            onPageChange?.(index);
            prefetchAdjacent(index, pdfInfo?.page_count ?? 0, dpi);
            if (zoomLevelRef.current !== 1) void renderSharp(zoomLevelRef.current);
            maybeSeekPrecache(index, dpi);
          }
        } finally {
          // Only tear down the spinner if this navigation is still current. A
          // superseded navigation must leave the spinner up for the newer
          // (current) navigation that is still rendering; that navigation owns
          // clearing it when its own render resolves.
          if (navSeqRef.current === mySeq) setPageLoading(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [filePath, paneId, pdfInfo, prefetchAdjacent, maybeSeekPrecache, onPageChange, renderSharp],
  );

  useEffect(() => {
    console.log("[sync:pdf] registerGoToPage for pane=%s", paneId);
    registerGoToPage?.(goToPage);
  }, [goToPage, registerGoToPage, paneId]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      // Zoom chords (ctrl/cmd) take priority and short-circuit page nav, which
      // otherwise fires on j/k/arrows without checking modifier keys.
      if (handleZoomKey(e)) return;
      const pageCount = pdfInfo?.page_count ?? 0;
      // Read the synchronous source of truth (the ref) that goToPage's guard
      // uses. On a rapid double-press the React `currentPage` state is still
      // stale (its commit is batched), so reading it would recompute the same
      // target the prior press already committed and get dropped by the ref
      // guard. The ref is always current.
      const current = currentPageRef.current;
      if (e.key === "j" || e.key === "ArrowRight") {
        if (current < pageCount - 1) {
          e.preventDefault();
          goToPage(current + 1);
        }
      } else if (e.key === "k" || e.key === "ArrowLeft") {
        if (current > 0) {
          e.preventDefault();
          goToPage(current - 1);
        }
      }
    },
    [pdfInfo, goToPage, handleZoomKey],
  );

  if (error) {
    return (
      <main
        className="flex flex-1 items-center justify-center bg-bg-primary-alt"
        data-testid="pdf-error"
      >
        <p className="text-red-500">{error}</p>
      </main>
    );
  }

  if (!rendered) {
    return (
      <main
        className="flex flex-1 flex-col items-center justify-center gap-2 bg-bg-primary-alt"
        data-testid="pdf-loading"
      >
        <SpinnerSvg className="h-5 w-5 text-text-faint" />
        <p className="text-text-faint">Loading PDF…</p>
      </main>
    );
  }

  const pageCount = pdfInfo?.page_count ?? 0;
  const dpr = window.devicePixelRatio || 1;
  // baseW/baseH are the CSS dimensions of the *current* bitmap, which was
  // rendered at logical zoom renderedZoomRef. The visual zoom still owed on top
  // of that bitmap is cssScale = zoomLevel / renderedZoom: before a sharp
  // re-render renderedZoom=1 so cssScale=zoomLevel (pure CSS upscale); after a
  // sharp re-render at zoom Z the bitmap is Z× larger and renderedZoom=Z, so
  // cssScale=1 (no further scaling — pixel-sharp).
  const baseW = rendered.width / dpr;
  const baseH = rendered.height / dpr;
  const cssScale = zoomLevel / renderedZoomRef.current;

  return (
    <main
      className="flex min-h-0 flex-1 flex-col items-center bg-bg-primary-alt focus:outline-none"
      data-testid="pdf-viewer"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-3 py-2">
        <button
          data-testid="pdf-prev"
          disabled={currentPage <= 0}
          onClick={() => goToPage(currentPageRef.current - 1)}
          className="rounded px-2 py-1 text-sm text-text-normal hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← Prev
        </button>
        <span data-testid="pdf-page-indicator" className="text-sm text-text-muted">
          Page {currentPage + 1} / {pageCount}
        </span>
        <span data-testid="pdf-zoom-indicator" className="text-sm text-text-muted">
          {Math.round(zoomLevel * 100)}%
        </span>
        <button
          data-testid="pdf-next"
          disabled={currentPage >= pageCount - 1}
          onClick={() => goToPage(currentPageRef.current + 1)}
          className="rounded px-2 py-1 text-sm text-text-normal hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Next →
        </button>
      </div>
      <div
        ref={scrollContainerRef}
        data-testid="pdf-scroll-container"
        className="relative flex-1 overflow-auto px-4 pb-4"
      >
        <div
          data-testid="pdf-zoom-wrapper"
          className="mx-auto"
          style={{ width: `${baseW * cssScale}px`, height: `${baseH * cssScale}px` }}
        >
          <img
            data-testid="pdf-page-image"
            src={convertFileSrc(rendered.png_path)}
            alt={`Page ${currentPage + 1}`}
            className="shadow-lg"
            style={{
              width: `${baseW}px`,
              // At/below 100% (cssScale <= 1) keep the shrink-to-fit constraint
              // so wide/landscape PDFs don't overflow the container. Once the
              // user zooms in (cssScale > 1) lift it so the scale() transform
              // can size the bitmap freely beyond the container.
              maxWidth: cssScale > 1 ? "none" : "100%",
              transform: `scale(${cssScale})`,
              transformOrigin: "top left",
            }}
          />
        </div>
        {pageLoading && (
          <div
            data-testid="pdf-page-loading"
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div className="rounded-full bg-bg-primary-alt/80 p-3 shadow">
              <SpinnerSvg className="h-6 w-6 text-text-faint" />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
