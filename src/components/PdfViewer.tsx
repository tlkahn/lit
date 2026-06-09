import { useEffect, useState, useCallback, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { pdfOpen, pdfRenderPage, pdfPrefetch, pdfClose } from "../lib/ipc";
import type { PdfInfo, RenderedPage } from "../lib/ipc";
import { SpinnerSvg } from "./SpinnerSvg";

const BASE_DPI = 144;
const MAX_CACHE = 5;

function getEffectiveDpi(): number {
  return Math.round(BASE_DPI * (window.devicePixelRatio || 1));
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
   * Publish this viewer's internal `goToPage` so an external owner (e.g. the
   * pane, for forward sync) can drive navigation imperatively. Called whenever
   * the callback identity changes so the always-current closure is registered.
   *
   * `ready` reflects whether the backend has the doc open (pdfInfo set): it is
   * `false` on the initial mount registration (before pdfOpen resolves, when
   * goToPage would call pdfRenderPage against an unopened doc) and `true` once
   * pdfInfo is set. The owner registers the live closure on every call but only
   * consumes/fires a pending initial sync on a ready registration (Finding 2).
   */
  registerGoToPage?: (fn: (pageIndex: number) => void, ready: boolean) => void;
  /**
   * Publish a getter for this viewer's SYNCHRONOUS current page (currentPageRef)
   * so an external owner (e.g. the status bar) can derive a navigation target
   * from the live ref rather than the lagging pane store, mirroring how the
   * keyboard handler reads currentPageRef directly.
   */
  registerGetCurrentPage?: (fn: () => number) => void;
}

export function PdfViewer({ filePath, paneId, onPageChange, onPageCount, registerGoToPage, registerGetCurrentPage }: PdfViewerProps) {
  const [pdfInfo, setPdfInfo] = useState<PdfInfo | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [rendered, setRendered] = useState<RenderedPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const filePathRef = useRef(filePath);
  const currentPageRef = useRef(currentPage);
  const cacheRef = useRef(new Map<string, RenderedPage>());
  const navSeqRef = useRef(0);
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

  const prefetchAdjacent = useCallback((pageIndex: number, pageCount: number, dpi: number) => {
    if (pageIndex > 0) pdfPrefetch(pageIndex - 1, dpi, paneId).catch(() => {});
    if (pageIndex < pageCount - 1) pdfPrefetch(pageIndex + 1, dpi, paneId).catch(() => {});
  }, [paneId]);

  useEffect(() => {
    filePathRef.current = filePath;
    cacheRef.current.clear();
    let cancelled = false;

    (async () => {
      try {
        const info = await pdfOpen(filePath, paneId);
        if (cancelled) return;
        setPdfInfo(info);
        setCurrentPage(0);
        currentPageRef.current = 0;
        onPageCountRef.current?.(info.page_count);

        const dpi = getEffectiveDpi();
        const page = await pdfRenderPage(0, dpi, paneId);
        if (cancelled) return;
        cacheSet(cacheRef.current, cacheKey(0, dpi), page);
        setRendered(page);
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
      pdfClose(paneId).catch(() => {});
    };
  }, [filePath, paneId, prefetchAdjacent]);

  const goToPage = useCallback(
    async (index: number) => {
      if (index === currentPageRef.current) return;
      // Monotonic navigation token: any newer navigation (even a synchronous
      // cache hit) supersedes an in-flight slow render so it cannot revert us.
      const mySeq = ++navSeqRef.current;
      // Advance the ref synchronously to the navigation target so a rapid
      // second key-press (which reads currentPageRef before this invocation's
      // awaited render commits) derives the *next* target instead of recomputing
      // this same one and getting dropped by the same-page guard above.
      currentPageRef.current = index;
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
    [filePath, paneId, pdfInfo, prefetchAdjacent, onPageChange],
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
      className="flex min-h-0 flex-1 flex-col items-center bg-bg-primary-alt focus:outline-none"
      data-testid="pdf-viewer"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="relative flex-1 overflow-auto px-4 pb-4">
        <img
          data-testid="pdf-page-image"
          src={convertFileSrc(rendered.png_path)}
          alt={`Page ${currentPage + 1}`}
          className="mx-auto shadow-lg"
          style={{ maxWidth: "100%", width: `${rendered.width / (window.devicePixelRatio || 1)}px` }}
        />
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
