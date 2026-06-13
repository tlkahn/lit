import { useEffect, useState, useCallback, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { allowAssetScope } from "../lib/ipc";
import { loadDocument, TextLayer, AnnotationLayer, setLayerDimensions } from "../lib/pdfjs";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "../lib/pdfjs";
import { createPdfLinkService } from "../lib/pdfLinkService";
import { SpinnerSvg } from "./SpinnerSvg";
import "./PdfTextAnnotationLayers.css";

// Delay before the page-transition spinner becomes visible, so fast
// transitions don't flash it on every keypress.
const SPINNER_GRACE_MS = 150;

// Discrete zoom steps for per-pane zoom control.
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0] as const;
const MAX_CANVAS_SCALE = 4.0;
const DEFAULT_ZOOM = 1.0;

// Maximum number of pages to keep in the text/annotation layer cache.
// Covers the current page plus a handful of recently-visited neighbors,
// which is sufficient for typical back-and-forth reading and zoom re-renders.
// Older entries are evicted LRU-first to keep JS memory bounded on long reads.
const LAYER_CACHE_CAP = 5;

/** Return the cached value for `key`, promoting it to most-recently-used. */
function lruGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  const val = map.get(key);
  if (val !== undefined) {
    map.delete(key);
    map.set(key, val);
  }
  return val;
}

/** Insert or update `key`, evicting the least-recently-used entry when size exceeds `cap`. */
function lruSet<K, V>(map: Map<K, V>, key: K, val: V, cap: number): void {
  // If the key already exists, delete first so the re-set moves it to MRU position.
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, val);
  // Evict the oldest entry (first in Map iteration order) if we exceed the cap.
  while (map.size > cap) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
    else break;
  }
}

interface RenderTask {
  promise: Promise<void>;
  cancel: () => void;
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
}

export function PdfViewer({ filePath, paneId, onPageChange, onPageCount, registerGoToPage, registerGetCurrentPage }: PdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [canvasReady, setCanvasReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  // zoomLevel state mirrors zoomLevelRef for future StatusBar display.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM);
  const [panCursor, setPanCursor] = useState<"grab" | "grabbing" | null>(null);

  const filePathRef = useRef(filePath);
  const currentPageRef = useRef(currentPage);
  const navSeqRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const zoomLevelRef = useRef(DEFAULT_ZOOM);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageContainerRef = useRef<HTMLDivElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const annotationLayerRef = useRef<HTMLDivElement | null>(null);
  const textLayerInstanceRef = useRef<InstanceType<typeof TextLayer> | null>(null);
  const goToPageRef = useRef<(index: number) => void>(() => {});
  const pageCountRef = useRef(0);
  const currentPageProxyRef = useRef<PDFPageProxy | null>(null);
  // Cache text content and annotations per page index to avoid re-fetching
  // from the pdf.js worker on every zoom re-render (only the scale changes).
  const layerCacheRef = useRef<Map<number, { textContent: Awaited<ReturnType<PDFPageProxy['getTextContent']>>; annotations: unknown[] }>>(new Map());
  // Deduplication map for in-flight cache fetches: if a zoom re-render fires
  // before the initial page's async layer work has populated layerCacheRef,
  // the zoom's IIFE awaits the same promise instead of calling
  // getTextContent/getAnnotations a second time.
  const pendingCacheRef = useRef<Map<number, Promise<{ textContent: Awaited<ReturnType<PDFPageProxy['getTextContent']>>; annotations: unknown[] }>>>(new Map());
  const dragRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const spaceHeldRef = useRef(false);

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

  const renderTextLayer = useCallback(async (
    page: PDFPageProxy,
    container: HTMLDivElement,
    viewport: PageViewport,
    navSeq: number,
    cachedTextContent?: Awaited<ReturnType<PDFPageProxy['getTextContent']>>,
  ) => {
    textLayerInstanceRef.current?.cancel();

    const textContent = cachedTextContent ?? await page.getTextContent();
    if (navSeqRef.current !== navSeq) return; // stale — bail

    container.innerHTML = "";
    const textLayer = new TextLayer({ textContentSource: textContent, container, viewport });
    textLayerInstanceRef.current = textLayer;
    await textLayer.render();
    if (navSeqRef.current !== navSeq) { container.innerHTML = ""; return; } // stale — clean up

    setLayerDimensions(container, viewport);
  }, []);

  const renderAnnotationLayer = useCallback(async (
    page: PDFPageProxy,
    container: HTMLDivElement,
    viewport: PageViewport,
    navSeq: number,
    cachedAnnotations?: unknown[],
  ) => {
    const annotations = (cachedAnnotations ?? await page.getAnnotations({ intent: "display" })) as Awaited<ReturnType<PDFPageProxy['getAnnotations']>>;
    if (navSeqRef.current !== navSeq) return; // stale — bail

    container.innerHTML = "";
    if (annotations.length === 0) return;

    const linkService = createPdfLinkService({
      pagesCount: pageCountRef.current,
      getCurrentPage: () => currentPageRef.current,
      goToPage: (idx: number) => goToPageRef.current(idx),
      pdfDocument: pdfDoc,
    });

    const annotationLayer = new AnnotationLayer({
      div: container,
      accessibilityManager: null,
      annotationCanvasMap: null,
      annotationEditorUIManager: null,
      page,
      viewport,
      structTreeLayer: null,
    });

    await annotationLayer.render({
      viewport,
      div: container,
      annotations,
      page,
      linkService,
      renderForms: false,
    });

    if (navSeqRef.current !== navSeq) { container.innerHTML = ""; return; } // stale — clean up

    setLayerDimensions(container, viewport);
  }, []);

  const renderPageToCanvas = useCallback(async (page: PDFPageProxy, pageIndex: number) => {
    const navSeq = navSeqRef.current;
    renderTaskRef.current?.cancel();

    const dpr = window.devicePixelRatio || 1;
    const zoom = zoomLevelRef.current;
    const effectiveScale = dpr * zoom;
    const canvasScale = Math.min(effectiveScale, MAX_CANVAS_SCALE);
    const viewport = page.getViewport({ scale: canvasScale });
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const cssWidth = Math.floor(viewport.width / canvasScale * zoom);
    canvas.style.width = cssWidth + "px";
    canvas.style.height = "auto";

    // Size the page container to match the canvas CSS dimensions
    if (pageContainerRef.current) {
      pageContainerRef.current.style.width = cssWidth + "px";
    }

    const ctx = canvas.getContext("2d")!;
    const renderTask = page.render({ canvasContext: ctx, viewport });
    renderTaskRef.current = renderTask;

    try {
      await renderTask.promise;
    } catch (e: unknown) {
      // pdf.js throws RenderingCancelledException when cancel() is called
      if (e && typeof e === "object" && "name" in e && (e as { name: string }).name === "RenderingCancelledException") {
        return;
      }
      throw e;
    }

    // Defense-in-depth: if a newer operation bumped navSeq after the canvas
    // render completed but before we kick off text/annotation layer setup,
    // bail early so stale layers don't overwrite current content.
    if (navSeqRef.current !== navSeq) return;

    // --- Canvas is painted. Layer work (text/annotation extraction and
    // rendering) happens asynchronously off the critical path so that
    // canvasReady flips and the spinner clears immediately. ---
    const cssViewport = page.getViewport({ scale: zoom });

    // Fire-and-forget: layer cache population + layer rendering.
    // Captures navSeq from the outer closure for staleness checks.
    (async () => {
      try {
        let cached = lruGet(layerCacheRef.current, pageIndex);
        if (!cached) {
          // Deduplicate in-flight fetches so a rapid zoom re-render
          // doesn't trigger a second getTextContent/getAnnotations call
          // for the same page while the first is still pending.
          let pending = pendingCacheRef.current.get(pageIndex);
          if (!pending) {
            pending = Promise.all([
              page.getTextContent(),
              page.getAnnotations({ intent: "display" }),
            ]).then(([textContent, annotations]) => ({ textContent, annotations }));
            pendingCacheRef.current.set(pageIndex, pending);
          }
          const result = await pending;
          pendingCacheRef.current.delete(pageIndex);
          if (navSeqRef.current !== navSeq) return;
          cached = result;
          lruSet(layerCacheRef.current, pageIndex, cached, LAYER_CACHE_CAP);
        }

        if (textLayerRef.current) {
          renderTextLayer(page, textLayerRef.current, cssViewport, navSeq, cached.textContent).catch(() => {});
        }
        if (annotationLayerRef.current) {
          renderAnnotationLayer(page, annotationLayerRef.current, cssViewport, navSeq, cached.annotations).catch(() => {});
        }
      } catch {
        // Layer errors are non-fatal — swallow so the viewer stays up.
      }
    })();
  }, [renderTextLayer, renderAnnotationLayer]);

  useEffect(() => {
    filePathRef.current = filePath;
    setPdfDoc(null);
    setPageCount(0);
    setCurrentPage(0);
    currentPageRef.current = 0;
    setCanvasReady(false);
    setError(null);
    setPageLoading(false);
    setZoomLevel(DEFAULT_ZOOM);
    zoomLevelRef.current = DEFAULT_ZOOM;
    renderTaskRef.current?.cancel();
    layerCacheRef.current.clear();
    pendingCacheRef.current.clear();

    let cancelled = false;
    let localDoc: PDFDocumentProxy | null = null;

    (async () => {
      try {
        // Extend the asset protocol scope to include this file before
        // converting it to an asset:// URL. This is necessary for PDFs
        // outside the workspace root (e.g. companions found via absolute
        // search paths in preferences). The call is idempotent — re-allowing
        // an already-scoped file is harmless.
        await allowAssetScope(filePath);
        const url = convertFileSrc(filePath);
        const doc = await loadDocument(url);
        if (cancelled) {
          doc.destroy();
          return;
        }
        localDoc = doc;
        setPdfDoc(doc);
        setPageCount(doc.numPages);
        pageCountRef.current = doc.numPages;
        onPageCountRef.current?.(doc.numPages);

        const page = await doc.getPage(1); // pdf.js uses 1-based page numbers
        if (cancelled) return;

        await renderPageToCanvas(page, 0);
        if (cancelled) return;

        currentPageProxyRef.current = page;
        setCanvasReady(true);
        // Publish the initial page exactly once so the parent's status bar and
        // reverse sync are seeded. The goToPage same-page guard would otherwise
        // suppress this for page 0 since currentPageRef is already 0.
        onPageChangeRef.current?.(0);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      textLayerInstanceRef.current?.cancel();
      textLayerInstanceRef.current = null;
      currentPageProxyRef.current = null;
      localDoc?.destroy();
    };
  }, [filePath, paneId, renderPageToCanvas]);

  const goToPage = useCallback(
    async (index: number) => {
      if (index === currentPageRef.current) return;
      // Monotonic navigation token: any newer navigation supersedes an
      // in-flight slow render so it cannot revert us.
      const mySeq = ++navSeqRef.current;
      // Save the previous page so we can revert on failure.
      const prevPage = currentPageRef.current;
      // Advance the ref synchronously to the navigation target so a rapid
      // second key-press (which reads currentPageRef before this invocation's
      // awaited render commits) derives the *next* target instead of recomputing
      // this same one and getting dropped by the same-page guard above.
      currentPageRef.current = index;

      setPageLoading(true);
      try {
        const page = await pdfDoc!.getPage(index + 1); // 0-based to 1-based
        if (filePathRef.current !== filePath || navSeqRef.current !== mySeq) return;

        await renderPageToCanvas(page, index);
        if (navSeqRef.current !== mySeq) return;

        // Release decoded images / operator list / fonts from the
        // previously-displayed page to bound memory on long reads.
        const oldProxy = currentPageProxyRef.current;
        currentPageProxyRef.current = page;
        if (oldProxy && oldProxy !== page) {
          oldProxy.cleanup();
        }

        setCurrentPage(index);
        currentPageRef.current = index;
        onPageChange?.(index);
      } catch (err) {
        if (navSeqRef.current === mySeq) {
          // Per-page navigation failures are non-fatal: revert to the previous
          // page and log a warning instead of blowing away the entire viewer.
          currentPageRef.current = prevPage;
          console.warn("[PdfViewer] page navigation failed:", err);
        }
      } finally {
        // Only tear down the spinner if this navigation is still current. A
        // superseded navigation must leave the spinner up for the newer
        // (current) navigation that is still rendering; that navigation owns
        // clearing it when its own render resolves.
        if (navSeqRef.current === mySeq) setPageLoading(false);
      }
    },
    [filePath, paneId, pdfDoc, onPageChange, renderPageToCanvas],
  );

  // Keep goToPageRef in sync so the link service always calls the latest goToPage.
  useEffect(() => {
    goToPageRef.current = goToPage;
  }, [goToPage]);

  useEffect(() => {
    registerGoToPage?.(goToPage, pdfDoc !== null);
  }, [goToPage, registerGoToPage, paneId, pdfDoc]);

  // Publish a stable getter that reads currentPageRef.current at call time, so
  // the status bar always sees the synchronous navigation target (set in
  // goToPage above) even while an async render is still in flight.
  useEffect(() => {
    registerGetCurrentPage?.(() => currentPageRef.current);
  }, [registerGetCurrentPage]);

  // Grace period: only surface the spinner if the transition outlives
  // SPINNER_GRACE_MS, so fast page flips never flash it.
  const [spinnerVisible, setSpinnerVisible] = useState(false);
  useEffect(() => {
    if (!pageLoading) {
      setSpinnerVisible(false);
      return;
    }
    const t = setTimeout(() => setSpinnerVisible(true), SPINNER_GRACE_MS);
    return () => clearTimeout(t);
  }, [pageLoading]);

  const reRenderAtZoom = useCallback(
    async (newZoom: number) => {
      // Bump navSeq so this zoom participates in the same coordination
      // protocol as goToPage. Any in-flight navigation (or prior zoom)
      // whose captured seq no longer matches will bail, and vice-versa.
      const mySeq = ++navSeqRef.current;
      zoomLevelRef.current = newZoom;
      setZoomLevel(newZoom);
      if (!pdfDoc) return;

      const container = scrollContainerRef.current;
      const scrollFraction =
        container && container.scrollHeight > 0
          ? container.scrollTop / container.scrollHeight
          : 0;

      try {
        const page = await pdfDoc.getPage(currentPageRef.current + 1);
        if (navSeqRef.current !== mySeq) return;

        await renderPageToCanvas(page, currentPageRef.current);
        if (navSeqRef.current !== mySeq) return;

        // Update the proxy ref so a subsequent goToPage can clean up
        // this page. For same-page zoom, getPage returns the same cached
        // proxy, so oldProxy === page and no cleanup fires.
        const oldProxy = currentPageProxyRef.current;
        currentPageProxyRef.current = page;
        if (oldProxy && oldProxy !== page) {
          oldProxy.cleanup();
        }

        if (container) {
          requestAnimationFrame(() => {
            container.scrollTop = scrollFraction * container.scrollHeight;
          });
        }
      } catch {
        // Zoom re-render failed; swallow to avoid crashing the viewer
      }
    },
    [pdfDoc, renderPageToCanvas],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " && !e.repeat && !spaceHeldRef.current) {
        spaceHeldRef.current = true;
        setPanCursor("grab");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") {
        spaceHeldRef.current = false;
        dragRef.current = null;
        setPanCursor(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    if (!spaceHeldRef.current) return;
    if (annotationLayerRef.current?.contains(e.target as Node)) return;
    e.preventDefault();
    const container = scrollContainerRef.current;
    if (!container) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    };
    setPanCursor("grabbing");
  }, []);

  const handleMouseMove = useCallback((e: ReactMouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollLeft = drag.scrollLeft - (e.clientX - drag.startX);
    container.scrollTop = drag.scrollTop - (e.clientY - drag.startY);
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setPanCursor(spaceHeldRef.current ? "grab" : null);
  }, []);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Zoom shortcuts: Cmd/Ctrl + =, +, -, 0
      if (isMod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        e.nativeEvent.stopImmediatePropagation();
        const idx = ZOOM_STEPS.findIndex(s => s > zoomLevelRef.current);
        if (idx === -1) return;
        reRenderAtZoom(ZOOM_STEPS[idx]!);
        return;
      }
      if (isMod && e.key === "-") {
        e.preventDefault();
        e.nativeEvent.stopImmediatePropagation();
        // Find the last step below current zoom
        let prevIdx = -1;
        for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
          if (ZOOM_STEPS[i]! < zoomLevelRef.current) {
            prevIdx = i;
            break;
          }
        }
        if (prevIdx === -1) return;
        reRenderAtZoom(ZOOM_STEPS[prevIdx]!);
        return;
      }
      if (isMod && e.key === "0") {
        e.preventDefault();
        e.nativeEvent.stopImmediatePropagation();
        reRenderAtZoom(DEFAULT_ZOOM);
        return;
      }

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
    [pageCount, goToPage, reRenderAtZoom],
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

  return (
    <main
      className={canvasReady
        ? "relative flex min-h-0 flex-1 flex-col items-center bg-bg-primary-alt focus:outline-none"
        : "flex flex-1 flex-col items-center justify-center gap-2 bg-bg-primary-alt"
      }
      data-testid={canvasReady ? "pdf-viewer" : "pdf-loading"}
      tabIndex={canvasReady ? 0 : undefined}
      onKeyDown={canvasReady ? handleKeyDown : undefined}
    >
      {!canvasReady && (
        <>
          <SpinnerSvg className="h-5 w-5 text-text-faint" />
          <p className="text-text-faint">Loading PDF…</p>
        </>
      )}
      <div
        ref={scrollContainerRef}
        className={canvasReady ? `flex-1 overflow-auto px-4 pb-4${panCursor ? ` cursor-${panCursor}` : ""}` : undefined}
        style={canvasReady ? undefined : { display: "none" }}
        onMouseDown={canvasReady ? handleMouseDown : undefined}
        onMouseMove={canvasReady ? handleMouseMove : undefined}
        onMouseUp={canvasReady ? handleMouseUp : undefined}
        onMouseLeave={canvasReady ? handleMouseUp : undefined}
      >
        <div ref={pageContainerRef} className={canvasReady ? "mx-auto shadow-lg" : undefined} style={{ position: "relative", display: "inline-block" }}>
          <canvas
            ref={canvasRef}
            data-testid="pdf-page-canvas"
          />
          <div ref={textLayerRef} className="textLayer" data-testid="pdf-text-layer" />
          <div ref={annotationLayerRef} className="annotationLayer" data-testid="pdf-annotation-layer" />
        </div>
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
