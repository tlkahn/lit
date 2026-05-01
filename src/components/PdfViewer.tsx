import { useEffect, useState, useCallback, useRef } from "react";
import { pdfOpen, pdfRenderPage, pdfClose } from "../lib/ipc";
import type { PdfInfo, RenderedPage } from "../lib/ipc";

interface PdfViewerProps {
  filePath: string;
}

export function PdfViewer({ filePath }: PdfViewerProps) {
  const [pdfInfo, setPdfInfo] = useState<PdfInfo | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [rendered, setRendered] = useState<RenderedPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filePathRef = useRef(filePath);

  useEffect(() => {
    filePathRef.current = filePath;
    let cancelled = false;

    (async () => {
      try {
        const info = await pdfOpen(filePath);
        if (cancelled) return;
        setPdfInfo(info);
        setCurrentPage(0);

        const page = await pdfRenderPage(0, 1.0);
        if (cancelled) return;
        setRendered(page);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      pdfClose().catch(() => {});
    };
  }, [filePath]);

  const goToPage = useCallback(
    async (index: number) => {
      try {
        const page = await pdfRenderPage(index, 1.0);
        if (filePathRef.current === filePath) {
          setRendered(page);
          setCurrentPage(index);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [filePath],
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
          src={`data:image/png;base64,${rendered.png_base64}`}
          alt={`Page ${currentPage + 1}`}
          className="mx-auto shadow-lg"
          style={{ maxWidth: "100%" }}
        />
      </div>
    </main>
  );
}
