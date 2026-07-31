import type { AnnotationType } from "../../lib/ipc";
import { useMarkConfigStore } from "../../stores/markConfig";

export const CLS = {
  PILL: "cm-annotation-pill",
  PILL_MINIMAL: "cm-annotation-pill-minimal",
  PILL_ICON: "cm-annotation-pill-icon",
  PILL_BODY: "cm-annotation-pill-body",

  CALLOUT: "cm-annotation-callout",
  CALLOUT_HEADER: "cm-annotation-callout-header",
  CALLOUT_LABEL: "cm-annotation-callout-label",
  CALLOUT_BODY: "cm-annotation-callout-body",

  MARKER: "cm-annotation-marker",
  MARKER_WRAP: "cm-annotation-marker-wrap",

  FIRE_BTN: "cm-annotation-fire-btn",
  FIRE_DISABLED: "cm-annotation-fire-disabled",
  FIRE_PROXIMITY: "cm-annotation-fire-proximity",

  CARDBOX_LINK: "cm-annotation-cardbox-link",

  SPINNER: "cm-annotation-spinner",
  STOP_ICON: "cm-annotation-stop-icon",
  FOLD_ICON: "cm-annotation-fold-icon",

  TENTATIVE: "cm-annotation-tentative",
  FIRM: "cm-annotation-firm",

  THREAD: "cm-thread",
  THREAD_NAV: "cm-thread-nav",
  THREAD_NAV_ARROW: "cm-thread-nav-arrow",
  THREAD_TURN_COUNTER: "cm-thread-turn-counter",
  THREAD_QUESTION: "cm-thread-question",
  THREAD_EMPTY: "cm-thread-empty",
  THREAD_OVERFLOW: "cm-thread-overflow",
  THREAD_OVERFLOW_MENU: "cm-thread-overflow-menu",
  THREAD_OVERFLOW_ROW: "cm-thread-overflow-row",
  THREAD_FOLLOWUP_TRIGGER: "cm-thread-followup-trigger",
  THREAD_FOLLOWUP_INPUT: "cm-thread-followup-input",

  IS_COLLAPSED: "is-collapsed",
  IS_OPEN: "is-open",
  SVG_ICON: "svg-icon",
} as const;

export const TYPE_ICON: Record<AnnotationType, string> = {
  note: "N",
  question: "?",
  todo: "T",
  crossref: "→",
  apparatus: "⊕",
  translation: "译",
  llm: "⚡",
  thread: "◇",
  slipnote: "S",
  mark: "◆",
  bare: "…",
};

// Pill badge text for a mark code; falls back to the code itself.
export function getMarkIcon(code: string): string {
  const def = useMarkConfigStore.getState().getDef(code);
  return def?.icon ?? code;
}

export function certaintyMark(certainty: string): string {
  if (certainty === "tentative") return "?";
  if (certainty === "firm") return "!";
  return "";
}

export function certaintyClass(certainty: string): string {
  if (certainty === "tentative") return CLS.TENTATIVE;
  if (certainty === "firm") return CLS.FIRM;
  return "";
}

export function truncateBody(body: string | null, max = 60): string {
  if (!body) return "";
  if (body.length <= max) return body;
  let cut = body.slice(0, max);
  // Don't strand the high half of a surrogate pair at the cut point.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut + "…";
}
