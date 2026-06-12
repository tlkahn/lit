import { useEffect, useState, useCallback, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { pdfOpen, pdfRenderPage, pdfPrefetch, pdfClose } from "../lib/ipc";
import type { PdfInfo, RenderedPage } from "../lib/ipc";
import { SpinnerSvg } from "./SpinnerSvg";

const BASE_DPI = 144;
export const MAX_EFFECTIVE_DPI = 600;
// Frontend render cache.  Must be well below MAX_BACKEND_CACHE (24, in
// src-tauri/src/pdf/mod.rs) so the backend LRU never evicts a PNG that
// the frontend still references.
const MAX_CACHE = 5;
// Delay before the page-transition spinner becomes visible, so fast
// transitions (prefetched j/k flips) don't flash it on every keypress.
const SPINNER_GRACE_MS = 150;
export const ZOOM_RENDER_DEBOUNCE_MS = 120;

const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
const ZOOM_DEFAULT_INDEX = 5;

function getEffectiveDpi(zoom: number = 1): number {
  return Math.min(MAX_EFFECTIVE_DPI, Math.round(BASE_DPI * (window.devicePixelRatio || 1) * zoom));
}

function cacheKey(pageIndex: number, dpi: number): string {
  return `${pageIndex}_${dpi}`;
}

function cacheSet(cache: Map<string, RenderedPage>, key: string, value: RenderedPage) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
  }
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
  onPageChange?: (pageIndex: number) => void;
  onPageCount?: (count: number) => void;
  /**
   * Publish this viewer's `goToPage`. `ready` is false before the backend doc
   * is open; the owner should only consume a pending sync on a ready call.
   */
  registerGoToPage?: (fn: (pageIndex: number) => void, ready: boolean) => void;
  /**
   * Publish a getter for this viewer's SYNCHRONOUS current page (currentPageRef)
   * so an external owner (e.g. the status bar) can derive a navigation target
   * from the live ref rather than the lagging pane store, mirroring how the
   * keyboard handler reads currentPageRef directly.
   */
  registerGetCurrentPage?: (fn: () => number) => void;
  /**
   * Publish this viewer's zoom callbacks so external owners (e.g. the global
   * command registry) can drive zoom without needing DOM focus on the viewer.
   */
  registerZoomHandlers?: (handlers: { zoomIn: () => void; zoomOut: () => void; zoomReset: () => void }) => void;
}

export function PdfViewer({ filePath, paneId, onPageChange, onPageCount, registerGoToPage, registerGetCurrentPage, registerZoomHandlers }: PdfViewerProps) {
  const [pdfInfo, setPdfInfo] = useState<PdfInfo | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [rendered, setRendered] = useState<RenderedPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  // The src of the last image that actually finished painting. The IPC render
  // resolving (pageLoading → false) only means the PNG exists on disk; the
  // user-visible stale window is the browser fetching/decoding the new PNG
  // after the <img src> swap. Tracking the painted src lets the spinner cover
  // that window too (issue #456).
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const filePathRef = useRef(filePath);
  const currentPageRef = useRef(currentPage);
  // The page index of the last render that actually committed (was displayed).
  // Used to roll back currentPageRef when the latest render fails.
  const committedPageRef = useRef(0);
  const [zoomIndex, setZoomIndex] = useState(ZOOM_DEFAULT_INDEX);
  const zoomIndexRef = useRef(ZOOM_DEFAULT_INDEX);
  const cacheRef = useRef(new Map<string, RenderedPage>());
  const navSeqRef = useRef(0);
  const zoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Page width at BASE_DPI (DPI-independent, zoom-independent).
  // CSS display width = baseWidthCss * zoom, decoupling display from DPI clamp.
  const baseWidthCssRef = useRef<number>(0);
  const pagePublishPendingRef = useRef(false);
  // True after the first <img> onLoad/onError fires for the current file.
  // Suppresses the `loadedSrc !== src` branch of `transitioning` during the
  // initial decode after the "Loading PDF…" screen disappears, preventing a
  // spurious spinner flash while the browser fetches/decodes the very first PNG.
  const hasEverPaintedRef = useRef(false);
  // Keep an always-current ref to onPageChange so the mount effect can publish
  // the initial page without listing onPageChange as a dependency (which would
  // re-open the PDF and reset to page 0 on every callback identity change).
  const onPageChangeRef = useRef(onPageChange);
  useEffect(() => {
    onPageChangeRef.current = onPageChange;
  }, [onPageChange]);
  const onPageCountRef = useRef(onPageCount);
  useEffect(() => {
    onPageCountRef.current = onPageCount;
  }, [onPageCount]);

  const updateZoomIndex = useCallback((index: number) => {
    zoomIndexRef.current = index;
    setZoomIndex(index);
  }, []);

  const prefetchAdjacent = useCallback((pageIndex: number, pageCount: number, dpi: number) => {
    if (pageIndex > 0) pdfPrefetch(pageIndex - 1, dpi, paneId).catch(() => {});
    if (pageIndex < pageCount - 1) pdfPrefetch(pageIndex + 1, dpi, paneId).catch(() => {});
  }, [paneId]);

  useEffect(() => {
    filePathRef.current = filePath;
    cacheRef.current.clear();
    hasEverPaintedRef.current = false;
    zoomIndexRef.current = ZOOM_DEFAULT_INDEX;
    setZoomIndex(ZOOM_DEFAULT_INDEX);
    pagePublishPendingRef.current = false;
    committedPageRef.current = 0;
    baseWidthCssRef.current = 0;
    if (zoomDebounceRef.current !== null) {
      clearTimeout(zoomDebounceRef.current);
      zoomDebounceRef.current = null;
    }

    setRendered(null);
    setLoadedSrc(null);
    setError(null);
    let cancelled = false;

    (async () => {
      try {
        const info = await pdfOpen(filePath, paneId);
        if (cancelled) return;
        setPdfInfo(info);
        setCurrentPage(0);
        currentPageRef.current = 0;
        onPageCountRef.current?.(info.page_count);

        const dpi = getEffectiveDpi(ZOOM_LEVELS[ZOOM_DEFAULT_INDEX]);
        const page = await pdfRenderPage(0, dpi, paneId);
        if (cancelled) return;
        cacheSet(cacheRef.current, cacheKey(0, dpi), page);
        baseWidthCssRef.current = page.width * BASE_DPI / dpi;
        setRendered(page);
        committedPageRef.current = 0;
        // Publish the initial page exactly once so the parent's status bar and
        // reverse sync are seeded. The goToPage same-page guard would otherwise
        // suppress this for page 0 since currentPageRef is already 0.
        onPageChangeRef.current?.(0);
        prefetchAdjacent(0, info.page_count, dpi);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      if (zoomDebounceRef.current !== null) {
        clearTimeout(zoomDebounceRef.current);
        zoomDebounceRef.current = null;
      }
      pdfClose(paneId).catch(() => {});
    };
  }, [filePath, paneId, prefetchAdjacent]);

  const renderPage = useCallback(
    async (pageIndex: number, dpi: number, opts?: { publishPage?: boolean }) => {
      const mySeq = ++navSeqRef.current;
      const key = cacheKey(pageIndex, dpi);
      const cached = cacheGet(cacheRef.current, key);
      if (cached && filePathRef.current === filePath) {
        baseWidthCssRef.current = cached.width * BASE_DPI / dpi;
        setRendered(cached);
        setPageLoading(false);
        const shouldPublish = opts?.publishPage || (pagePublishPendingRef.current && pageIndex === currentPageRef.current);
        if (shouldPublish) {
          setCurrentPage(pageIndex);
          committedPageRef.current = pageIndex;
          onPageChange?.(pageIndex);
          pagePublishPendingRef.current = false;
        }
        prefetchAdjacent(pageIndex, pdfInfo?.page_count ?? 0, dpi);
        return;
      }

      setPageLoading(true);
      try {
        const rp = await pdfRenderPage(pageIndex, dpi, paneId);
        if (filePathRef.current === filePath && navSeqRef.current === mySeq) {
          cacheSet(cacheRef.current, key, rp);
          baseWidthCssRef.current = rp.width * BASE_DPI / dpi;
          setRendered(rp);
          const shouldPublish = opts?.publishPage || (pagePublishPendingRef.current && pageIndex === currentPageRef.current);
          if (shouldPublish) {
            setCurrentPage(pageIndex);
            currentPageRef.current = pageIndex;
            committedPageRef.current = pageIndex;
            onPageChange?.(pageIndex);
            pagePublishPendingRef.current = false;
          }
          prefetchAdjacent(pageIndex, pdfInfo?.page_count ?? 0, dpi);
        }
      } catch (err) {
        if (navSeqRef.current === mySeq) {
          // Latest render failed — roll back currentPageRef so j/k navigation
          // computes from the page actually displayed, and clear the pending
          // publish flag so a later unrelated render cannot spuriously publish.
          currentPageRef.current = committedPageRef.current;
          pagePublishPendingRef.current = false;
        }
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (navSeqRef.current === mySeq) setPageLoading(false);
      }
    },
    [filePath, paneId, pdfInfo, prefetchAdjacent, onPageChange],
  );

  const goToPage = useCallback(
    async (index: number) => {
      if (index === currentPageRef.current) return;
      // Advance the ref synchronously to the navigation target so a rapid
      // second key-press (which reads currentPageRef before this invocation's
      // awaited render commits) derives the *next* target instead of recomputing
      // this same one and getting dropped by the same-page guard above.
      currentPageRef.current = index;
      pagePublishPendingRef.current = true;
      await renderPage(index, getEffectiveDpi(ZOOM_LEVELS[zoomIndexRef.current]), { publishPage: true });
    },
    [renderPage],
  );

  useEffect(() => {
    registerGoToPage?.(goToPage, pdfInfo !== null);
  }, [goToPage, registerGoToPage, paneId, pdfInfo]);

  // Publish a stable getter that reads currentPageRef.current at call time, so
  // the status bar always sees the synchronous navigation target (set in
  // goToPage above) even while an async render is still in flight.
  useEffect(() => {
    registerGetCurrentPage?.(() => currentPageRef.current);
  }, [registerGetCurrentPage]);

  const src = rendered ? convertFileSrc(rendered.png_path) : null;
  const transitioning = pageLoading || (src !== null && hasEverPaintedRef.current && loadedSrc !== src);

  // Grace period: only surface the spinner if the transition outlives
  // SPINNER_GRACE_MS, so cache-hit/prefetched flips never flash it.
  const [spinnerVisible, setSpinnerVisible] = useState(false);
  useEffect(() => {
    if (!transitioning) {
      setSpinnerVisible(false);
      return;
    }
    const t = setTimeout(() => setSpinnerVisible(true), SPINNER_GRACE_MS);
    return () => clearTimeout(t);
  }, [transitioning]);

  const renderAtZoom = useCallback(
    (newZoomIndex: number) => {
      if (zoomDebounceRef.current !== null) {
        clearTimeout(zoomDebounceRef.current);
      }
      zoomDebounceRef.current = setTimeout(() => {
        zoomDebounceRef.current = null;
        const pageIndex = currentPageRef.current;
        renderPage(pageIndex, getEffectiveDpi(ZOOM_LEVELS[newZoomIndex]));
      }, ZOOM_RENDER_DEBOUNCE_MS);
    },
    [renderPage],
  );

  const zoomIn = useCallback(() => {
    const next = Math.min(zoomIndexRef.current + 1, ZOOM_LEVELS.length - 1);
    if (next !== zoomIndexRef.current) {
      updateZoomIndex(next);
      renderAtZoom(next);
    }
  }, [updateZoomIndex, renderAtZoom]);

  const zoomOut = useCallback(() => {
    const next = Math.max(zoomIndexRef.current - 1, 0);
    if (next !== zoomIndexRef.current) {
      updateZoomIndex(next);
      renderAtZoom(next);
    }
  }, [updateZoomIndex, renderAtZoom]);

  const zoomReset = useCallback(() => {
    if (zoomIndexRef.current !== ZOOM_DEFAULT_INDEX) {
      updateZoomIndex(ZOOM_DEFAULT_INDEX);
      renderAtZoom(ZOOM_DEFAULT_INDEX);
    }
  }, [updateZoomIndex, renderAtZoom]);

  useEffect(() => {
    registerZoomHandlers?.({ zoomIn, zoomOut, zoomReset });
  }, [registerZoomHandlers, zoomIn, zoomOut, zoomReset]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
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
    [pdfInfo, goToPage],
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

  return (
    <main
      className="relative flex min-h-0 flex-1 flex-col items-center bg-bg-primary-alt focus:outline-none"
      data-testid="pdf-viewer"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="flex-1 overflow-auto px-4 pb-4">
        <img
          data-testid="pdf-page-image"
          src={src ?? undefined}
          alt={`Page ${currentPage + 1}`}
          className="mx-auto shadow-lg"
          style={{
            width: `${baseWidthCssRef.current > 0 ? baseWidthCssRef.current * ZOOM_LEVELS[zoomIndex]! : rendered.width / (window.devicePixelRatio || 1)}px`,
            maxWidth: ZOOM_LEVELS[zoomIndex]! <= 1 ? '100%' : undefined,
          }}
          onLoad={(e) => { hasEverPaintedRef.current = true; setLoadedSrc(e.currentTarget.getAttribute("src")); }}
          // A failed image load must not strand the spinner — the IPC render
          // already succeeded, so just end the transition.
          onError={(e) => { hasEverPaintedRef.current = true; setLoadedSrc(e.currentTarget.getAttribute("src")); }}
        />
      </div>
      {/* Sibling of the scroll container (not inside it) so the overlay pins
          to the visible pane instead of scrolling away with a tall page. */}
      {spinnerVisible && (
        <div
          data-testid="pdf-page-loading"
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <div className="rounded-full bg-bg-primary-alt/80 p-3 shadow">
            <SpinnerSvg className="h-6 w-6 text-text-faint" />
          </div>
        </div>
      )}
    </main>
  );
}
