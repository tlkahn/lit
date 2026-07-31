import { blockquote } from "./blockquote";

export interface QuoteTarget {
  uuid: string;
  text: string;
}

/**
 * Resolves the current text selection to a quote-to-slip-note target (#968):
 * the uuid of the card the selection anchors in, plus the selected text as a
 * markdown blockquote. Returns null when there is nothing quotable: no or
 * collapsed selection, whitespace-only text, or an anchor outside `root` or
 * outside any `[data-uuid]` card wrapper (data-uuid deliberately, so test
 * probe mocks resolve the same way as real cards).
 */
export function resolveQuoteTarget(
  sel: Selection | null,
  root: HTMLElement | null,
): QuoteTarget | null {
  if (!sel || !root || sel.isCollapsed) return null;
  const raw = sel.toString();
  if (!raw.trim()) return null;
  const anchor = sel.anchorNode;
  if (!anchor || !root.contains(anchor)) return null;
  const el = anchor instanceof Element ? anchor : anchor.parentElement;
  const uuid = el?.closest("[data-uuid]")?.getAttribute("data-uuid");
  if (!uuid) return null;
  return { uuid, text: blockquote(raw) };
}
