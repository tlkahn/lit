/**
 * Minimal IPDFLinkService implementation for Tauri.
 *
 * External URLs are opened in the system browser via the Tauri opener plugin;
 * internal PDF links call the provided goToPage callback (0-based index).
 */
import { openUrl } from "@tauri-apps/plugin-opener";

export function createPdfLinkService({
  pagesCount,
  getCurrentPage,
  goToPage,
}: {
  pagesCount: number;
  getCurrentPage: () => number;
  goToPage: (pageIndex: number) => void;
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

    async goToDestination(_dest: string | unknown[]) {
      // Named / explicit destinations are not supported in the minimal viewer.
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
