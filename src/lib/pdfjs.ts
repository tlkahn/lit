/**
 * Centralized pdf.js setup for the Tauri webview.
 *
 * Configures the Web Worker, CMap, and standard-font paths so every
 * consumer gets the same offline-first defaults. Phase 2's PdfViewer
 * will import `loadDocument` from here.
 */

import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

// ---------------------------------------------------------------------------
// Worker — bundled locally (no CDN). Vite resolves the `new URL(…)` pattern
// at build time and emits the worker as a hashed asset.
// ---------------------------------------------------------------------------
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).href;

// ---------------------------------------------------------------------------
// CMap + standard-font paths — served as static assets.
// The subdirectory name MUST match the `dest` values in the viteStaticCopy
// targets in vite.config.ts. See PDFJS_ASSET_DIR.
//
// NOTE: A packaged-build CJK smoke test (e.g., opening a CJK PDF in the
// production Tauri app) is still needed to verify cmap loading end-to-end,
// since vitest cannot exercise the actual HTTP serving layer.
// ---------------------------------------------------------------------------
export const PDFJS_ASSET_DIR = "pdfjs";
export const CMAP_URL = `${import.meta.env.BASE_URL}${PDFJS_ASSET_DIR}/cmaps/`;
export const CMAP_PACKED = true;
export const STANDARD_FONT_DATA_URL = `${import.meta.env.BASE_URL}${PDFJS_ASSET_DIR}/standard_fonts/`;

// ---------------------------------------------------------------------------
// Convenience loader — wraps getDocument with the standard config.
// ---------------------------------------------------------------------------
export async function loadDocument(
  src: string | URL | ArrayBuffer,
): Promise<PDFDocumentProxy> {
  const params: Record<string, unknown> = {
    cMapUrl: CMAP_URL,
    cMapPacked: CMAP_PACKED,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  };

  if (typeof src === "string") {
    params.url = src;
  } else if (src instanceof URL) {
    params.url = src.href;
  } else {
    // ArrayBuffer
    params.data = new Uint8Array(src);
  }

  return pdfjsLib.getDocument(params).promise;
}

// ---------------------------------------------------------------------------
// Re-exports for downstream consumers
// ---------------------------------------------------------------------------
export { pdfjsLib };
export type { PDFDocumentProxy };
export type { PDFPageProxy } from "pdfjs-dist";
export { TextLayer, AnnotationLayer, setLayerDimensions } from "pdfjs-dist";
export type { PageViewport } from "pdfjs-dist";
