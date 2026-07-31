import { blockquote } from "./blockquote";

export interface QuoteTarget {
  uuid: string;
  text: string;
}

/**
 * Resolves the current text selection to a quote-to-slip-note target (#968):
 * the uuid of the card the selection lives in, plus the selected text as a
 * markdown blockquote. Returns null when there is nothing quotable: no or
 * collapsed selection, whitespace-only text, an anchor outside `root` or
 * outside any `[data-uuid]` card wrapper (data-uuid deliberately, so test
 * probe mocks resolve the same way as real cards), or a selection whose
 * anchor and focus resolve to different cards — a cross-card drag must not
 * dump both cards' concatenated text into one note.
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
  const uuid = cardUuidOf(anchor);
  if (!uuid) return null;
  if (cardUuidOf(sel.focusNode) !== uuid) return null;
  return { uuid, text: blockquote(raw) };
}

// The text containers ⌘A may expand into — the card/group text opt-ins from
// the #root user-select rules in src/index.css (inputs and editors are
// excluded here: focus in those bails out before the shortcut runs).
const SELECTABLE_CONTAINERS = ".prose, [data-testid='card-original'], .group-name, pre, code";

/**
 * Expands a non-collapsed text selection anchored inside one of the grid's
 * selectable text containers to that whole container (#968): ⌘A becomes
 * "select this card's text" instead of hijacking the native shortcut.
 * Returns true when it expanded (the caller consumes the key), false when
 * there is nothing to expand and select-all-cards should proceed. Anchoring
 * on the container element itself (the state right after a first ⌘A) still
 * expands, so a repeat press never falls through to card multi-select.
 */
export function expandSelectionToCardText(
  sel: Selection | null,
  root: HTMLElement | null,
): boolean {
  if (!sel || !root || sel.isCollapsed) return false;
  const anchor = sel.anchorNode;
  if (!anchor || !root.contains(anchor)) return false;
  const el = anchor instanceof Element ? anchor : anchor.parentElement;
  const container = el?.closest(SELECTABLE_CONTAINERS);
  if (!container) return false;
  const range = document.createRange();
  range.selectNodeContents(container);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

function cardUuidOf(node: Node | null): string | null {
  if (!node) return null;
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest("[data-uuid]")?.getAttribute("data-uuid") ?? null;
}
