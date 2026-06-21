/**
 * Typed sidebar event constants, dispatch helpers, and subscribe helpers.
 *
 * Centralises the stringly-typed CustomEvent names and payload shapes that were
 * previously scattered across command files, Sidebar, ReferenceLibrary, and
 * editor extensions.  A rename or payload change is now compile-checked at
 * every call site.
 */

import type { SidebarTab } from "../hooks/useSidebarTab";

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface RevealInFileTreeDetail {
  relativePath: string;
}

export interface RevealBibEntryForPageDetail {
  relativePath: string;
}

export interface RevealBibEntryDetail {
  citekey: string;
  bibFile?: string;
}

// SetSidebarTab's detail is bare SidebarTab (not wrapped in an object).

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------

export const REVEAL_IN_FILE_TREE = "lit:reveal-in-file-tree" as const;
export const REVEAL_BIB_ENTRY_FOR_PAGE = "lit:reveal-bib-entry-for-page" as const;
export const REVEAL_BIB_ENTRY = "lit:reveal-bib-entry" as const;
export const SET_SIDEBAR_TAB = "lit:set-sidebar-tab" as const;

// ---------------------------------------------------------------------------
// Dispatch helpers
// ---------------------------------------------------------------------------

export function dispatchRevealInFileTree(relativePath: string): void {
  window.dispatchEvent(
    new CustomEvent<RevealInFileTreeDetail>(REVEAL_IN_FILE_TREE, {
      detail: { relativePath },
    }),
  );
}

export function dispatchRevealBibEntryForPage(relativePath: string): void {
  window.dispatchEvent(
    new CustomEvent<RevealBibEntryForPageDetail>(REVEAL_BIB_ENTRY_FOR_PAGE, {
      detail: { relativePath },
    }),
  );
}

export function dispatchRevealBibEntry(citekey: string, bibFile?: string): void {
  window.dispatchEvent(
    new CustomEvent<RevealBibEntryDetail>(REVEAL_BIB_ENTRY, {
      detail: { citekey, bibFile },
    }),
  );
}

export function dispatchSetSidebarTab(tab: SidebarTab): void {
  window.dispatchEvent(
    new CustomEvent<SidebarTab>(SET_SIDEBAR_TAB, { detail: tab }),
  );
}

// ---------------------------------------------------------------------------
// Subscribe helpers — each returns an unsubscribe function.
// ---------------------------------------------------------------------------

export function onRevealInFileTree(
  callback: (detail: RevealInFileTreeDetail) => void,
): () => void {
  const handler = (e: Event) => {
    callback((e as CustomEvent<RevealInFileTreeDetail>).detail);
  };
  window.addEventListener(REVEAL_IN_FILE_TREE, handler);
  return () => window.removeEventListener(REVEAL_IN_FILE_TREE, handler);
}

export function onRevealBibEntryForPage(
  callback: (detail: RevealBibEntryForPageDetail) => void,
): () => void {
  const handler = (e: Event) => {
    callback((e as CustomEvent<RevealBibEntryForPageDetail>).detail);
  };
  window.addEventListener(REVEAL_BIB_ENTRY_FOR_PAGE, handler);
  return () => window.removeEventListener(REVEAL_BIB_ENTRY_FOR_PAGE, handler);
}

export function onRevealBibEntry(
  callback: (detail: RevealBibEntryDetail) => void,
): () => void {
  const handler = (e: Event) => {
    callback((e as CustomEvent<RevealBibEntryDetail>).detail);
  };
  window.addEventListener(REVEAL_BIB_ENTRY, handler);
  return () => window.removeEventListener(REVEAL_BIB_ENTRY, handler);
}

export function onSetSidebarTab(
  callback: (tab: SidebarTab) => void,
): () => void {
  const handler = (e: Event) => {
    callback((e as CustomEvent<SidebarTab>).detail);
  };
  window.addEventListener(SET_SIDEBAR_TAB, handler);
  return () => window.removeEventListener(SET_SIDEBAR_TAB, handler);
}
