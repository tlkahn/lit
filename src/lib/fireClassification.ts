import type { AnnotationType } from "./ipc";

const FIRE_CLASSIFICATION: Record<AnnotationType, boolean> = {
  llm: true,
  translation: true,
  question: true,
  todo: false,
  note: false,
  crossref: false,
  apparatus: false,
  mark: false,
  bare: false,
};

export function canFire(type: AnnotationType): boolean {
  return FIRE_CLASSIFICATION[type];
}
