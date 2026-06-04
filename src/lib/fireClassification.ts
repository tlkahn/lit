import type { AnnotationType } from "./ipc";

const FIRE_TYPE_MAP: Record<AnnotationType, string | null> = {
  llm: "replacing",
  translation: "replacing",
  question: "replacing",
  todo: null,
  note: null,
  crossref: null,
  apparatus: null,
  mark: null,
  bare: null,
};

export function canFire(type: AnnotationType): boolean {
  return FIRE_TYPE_MAP[type] != null;
}
