import type { AnnotationType } from "./ipc";

export type FireType = "replacing";

const FIRE_TYPE_MAP: Record<AnnotationType, FireType | null> = {
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

export function classifyFireType(type: AnnotationType): FireType | null {
  return FIRE_TYPE_MAP[type];
}

export function isReplacingType(type: AnnotationType): boolean {
  return FIRE_TYPE_MAP[type] === "replacing";
}

export function canFire(type: AnnotationType): boolean {
  return FIRE_TYPE_MAP[type] != null;
}
