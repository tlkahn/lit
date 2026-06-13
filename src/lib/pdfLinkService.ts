/**
 * Minimal IPDFLinkService implementation for Tauri.
 *
 * External URLs are opened in the system browser via the Tauri opener plugin;
 * internal PDF links call the provided goToPage callback (0-based index).
 */
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Minimal interface for resolving PDF destinations.
 * Matches the subset of PDFDocumentProxy needed by goToDestination,
 * keeping coupling low and testing easy.
 */
export interface PdfDocumentForLinkService {
  getDestination(id: string): Promise<Array<unknown> | null>;
  getPageIndex(ref: { num: number; gen: number }): Promise<number>;
}

export function createPdfLinkService({
  pagesCount,
  getCurrentPage,
  goToPage,
  pdfDocument = null,
}: {
  pagesCount: number;
  getCurrentPage: () => number;
  goToPage: (pageIndex: number) => void;
  pdfDocument?: PdfDocumentForLinkService | null;
}) {
  return {
    get pagesCount() {
      return pagesCount;
    },
    get page() {
      return getCurrentPage() + 1; // 1-based
    },
    set page(val: number) {
      goToPage(val - 1); // convert to 0-based
    },
    get rotation() {
      return 0;
    },
    set rotation(_v: number) {
      /* no-op */
    },
    get isInPresentationMode() {
      return false;
    },
    get externalLinkEnabled() {
      return true;
    },
    set externalLinkEnabled(_v: boolean) {
      /* no-op */
    },

    async goToDestination(dest: string | unknown[]) {
      if (!pdfDocument) return;

      let explicitDest: unknown[] | null;

      if (typeof dest === "string") {
        explicitDest = await pdfDocument.getDestination(dest);
      } else if (Array.isArray(dest)) {
        explicitDest = dest;
      } else {
        console.error(`[pdfLinkService] goToDestination: invalid destination type`, dest);
        return;
      }

      if (!Array.isArray(explicitDest)) {
        console.error(`[pdfLinkService] goToDestination: destination resolved to non-array`, explicitDest);
        return;
      }

      const destRef = explicitDest[0];
      let pageIndex: number;

      if (typeof destRef === "object" && destRef !== null) {
        try {
          pageIndex = await pdfDocument.getPageIndex(destRef as { num: number; gen: number });
        } catch (err) {
          console.error(`[pdfLinkService] goToDestination: getPageIndex failed`, err);
          return;
        }
      } else if (typeof destRef === "number" && Number.isInteger(destRef)) {
        pageIndex = destRef;
      } else {
        console.error(`[pdfLinkService] goToDestination: invalid destRef`, destRef);
        return;
      }

      if (pageIndex < 0 || pageIndex >= pagesCount) {
        return;
      }

      goToPage(pageIndex);
    },

    goToPage(val: number | string) {
      const num = typeof val === "string" ? parseInt(val, 10) : val;
      if (Number.isFinite(num) && num >= 1 && num <= pagesCount) {
        goToPage(num - 1); // 1-based → 0-based
      }
    },

    addLinkAttributes(link: HTMLAnchorElement, url: string, newWindow?: boolean) {
      link.href = url;
      link.rel = "noopener noreferrer nofollow";
      if (newWindow) link.target = "_blank";
      link.addEventListener("click", (e) => {
        e.preventDefault();
        if (url.startsWith("http://") || url.startsWith("https://")) {
          openUrl(url);
        }
      });
    },

    getDestinationHash(_dest: unknown) {
      return "#";
    },
    getAnchorUrl(_hash: unknown) {
      return "#";
    },
    setHash(_hash: string) {
      /* no-op */
    },

    executeNamedAction(action: string) {
      if (action === "NextPage") {
        goToPage(getCurrentPage() + 1);
      } else if (action === "PrevPage") {
        goToPage(getCurrentPage() - 1);
      } else if (action === "FirstPage") {
        goToPage(0);
      } else if (action === "LastPage") {
        goToPage(pagesCount - 1);
      }
      // GoBack / GoForward: no history support
    },

    executeSetOCGState(_action: object) {
      /* no-op */
    },
  };
}
