import type { AnnotationType } from "../../lib/ipc";

export const TYPE_ICON: Record<AnnotationType, string> = {
  note: "N",
  question: "?",
  todo: "T",
  crossref: "→",
  apparatus: "⊕",
  translation: "译",
  bare: "…",
};

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
