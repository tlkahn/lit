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
  page?: number;
  onPageChange?: (pageIndex: number) => void;
  /**
   * Publish this viewer's internal `goToPage` so an external owner (e.g. the
   * pane, for forward sync) can drive navigation imperatively. Called whenever
   * the callback identity changes so the always-current closure is registered.
   */
  registerGoToPage?: (fn: (pageIndex: number) => void) => void;
}

export function PdfViewer({ filePath, paneId, page, onPageChange, registerGoToPage }: PdfViewerProps) {
  const [pdfInfo, setPdfInfo] = useState<PdfInfo | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [rendered, setRendered] = useState<RenderedPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const filePathRef = useRef(filePath);
  const cacheRef = useRef(new Map<string, RenderedPage>());

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

        const dpi = getEffectiveDpi();
        const page = await pdfRenderPage(0, dpi, paneId);
        if (cancelled) return;
        cacheSet(cacheRef.current, cacheKey(0, dpi), page);
        setRendered(page);
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
      try {
        const dpi = getEffectiveDpi();
        const key = cacheKey(index, dpi);
        const cached = cacheGet(cacheRef.current, key);
        if (cached && filePathRef.current === filePath) {
          setRendered(cached);
          setCurrentPage(index);
          onPageChange?.(index);
          prefetchAdjacent(index, pdfInfo?.page_count ?? 0, dpi);
          return;
        }

        setPageLoading(true);
        try {
          const rp = await pdfRenderPage(index, dpi, paneId);
          if (filePathRef.current === filePath) {
            cacheSet(cacheRef.current, key, rp);
            setRendered(rp);
            setCurrentPage(index);
            onPageChange?.(index);
            prefetchAdjacent(index, pdfInfo?.page_count ?? 0, dpi);
          }
        } finally {
          setPageLoading(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [filePath, paneId, pdfInfo, prefetchAdjacent, onPageChange],
  );

  // Publish the always-current goToPage closure to the external owner.
  useEffect(() => {
    registerGoToPage?.(goToPage);
  }, [goToPage, registerGoToPage]);

  // Controlled page: navigate when the `page` prop changes externally.
  // The `page !== currentPage` guard prevents an onPageChange/page feedback loop.
  useEffect(() => {
    if (page != null && page !== currentPage) {
      goToPage(page);
    }
  }, [page, currentPage, goToPage]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const pageCount = pdfInfo?.page_count ?? 0;
      if (e.key === "j" || e.key === "ArrowRight") {
        if (currentPage < pageCount - 1) {
          e.preventDefault();
          goToPage(currentPage + 1);
        }
      } else if (e.key === "k" || e.key === "ArrowLeft") {
        if (currentPage > 0) {
          e.preventDefault();
          goToPage(currentPage - 1);
        }
      }
    },
    [currentPage, pdfInfo, goToPage],
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
          onClick={() => goToPage(currentPage - 1)}
          className="rounded px-2 py-1 text-sm text-text-normal hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← Prev
        </button>
        <span data-testid="pdf-page-indicator" className="text-sm text-text-muted">
          Page {currentPage + 1} / {pageCount}
        </span>
        <button
          data-testid="pdf-next"
          disabled={currentPage >= pageCount - 1}
          onClick={() => goToPage(currentPage + 1)}
          className="rounded px-2 py-1 text-sm text-text-normal hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Next →
        </button>
      </div>
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
