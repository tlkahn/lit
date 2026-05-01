import { useEffect, useState, useCallback, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { pdfOpen, pdfRenderPage, pdfPrefetch, pdfClose } from "../lib/ipc";
import type { PdfInfo, RenderedPage } from "../lib/ipc";

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
}

export function PdfViewer({ filePath }: PdfViewerProps) {
  const [pdfInfo, setPdfInfo] = useState<PdfInfo | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [rendered, setRendered] = useState<RenderedPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filePathRef = useRef(filePath);
  const cacheRef = useRef(new Map<string, RenderedPage>());

  const prefetchAdjacent = useCallback((pageIndex: number, pageCount: number, dpi: number) => {
    if (pageIndex > 0) pdfPrefetch(pageIndex - 1, dpi).catch(() => {});
    if (pageIndex < pageCount - 1) pdfPrefetch(pageIndex + 1, dpi).catch(() => {});
  }, []);

  useEffect(() => {
    filePathRef.current = filePath;
    cacheRef.current.clear();
    let cancelled = false;

    (async () => {
      try {
        const info = await pdfOpen(filePath);
        if (cancelled) return;
        setPdfInfo(info);
        setCurrentPage(0);

        const dpi = getEffectiveDpi();
        const page = await pdfRenderPage(0, dpi);
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
      pdfClose().catch(() => {});
    };
  }, [filePath, prefetchAdjacent]);

  const goToPage = useCallback(
    async (index: number) => {
      try {
        const dpi = getEffectiveDpi();
        const key = cacheKey(index, dpi);
        const cached = cacheGet(cacheRef.current, key);
        if (cached && filePathRef.current === filePath) {
          setRendered(cached);
          setCurrentPage(index);
          prefetchAdjacent(index, pdfInfo?.page_count ?? 0, dpi);
          return;
        }

        const page = await pdfRenderPage(index, dpi);
        if (filePathRef.current === filePath) {
          cacheSet(cacheRef.current, key, page);
          setRendered(page);
          setCurrentPage(index);
          prefetchAdjacent(index, pdfInfo?.page_count ?? 0, dpi);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [filePath, pdfInfo, prefetchAdjacent],
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
        className="flex flex-1 items-center justify-center bg-bg-primary-alt"
        data-testid="pdf-loading"
      >
        <p className="text-text-faint">Loading PDF…</p>
      </main>
    );
  }

  const pageCount = pdfInfo?.page_count ?? 0;

  return (
    <main
      className="flex min-h-0 flex-1 flex-col items-center bg-bg-primary-alt"
      data-testid="pdf-viewer"
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
      <div className="flex-1 overflow-auto px-4 pb-4">
        <img
          data-testid="pdf-page-image"
          src={convertFileSrc(rendered.png_path)}
          alt={`Page ${currentPage + 1}`}
          className="mx-auto shadow-lg"
          style={{ maxWidth: "100%", width: `${rendered.width / (window.devicePixelRatio || 1)}px` }}
        />
      </div>
    </main>
  );
}
