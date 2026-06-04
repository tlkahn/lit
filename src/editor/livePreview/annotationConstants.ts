import type { AnnotationType } from "../../lib/ipc";
import { useMarkConfigStore } from "../../stores/markConfig";

export const TYPE_ICON: Record<AnnotationType, string> = {
  note: "N",
  question: "?",
  todo: "T",
  crossref: "→",
  apparatus: "⊕",
  translation: "译",
  llm: "⚡",
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
  if (certainty === "tentative") return "cm-annotation-tentative";
  if (certainty === "firm") return "cm-annotation-firm";
  return "";
}

export function truncateBody(body: string | null, max = 60): string {
  if (!body) return "";
  return body.length > max ? body.slice(0, max) + "…" : body;
}
