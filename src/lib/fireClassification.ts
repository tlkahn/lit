import type { AnnotationType } from "./ipc";

const REPLACING_TYPES: Set<AnnotationType> = new Set(["llm", "translation"]);
const PERSISTING_TYPES: Set<AnnotationType> = new Set(["question"]);

export type FireType = "replacing" | "persisting";

export function classifyFireType(type: AnnotationType): FireType | null {
  if (REPLACING_TYPES.has(type)) return "replacing";
  if (PERSISTING_TYPES.has(type)) return "persisting";
  return null;
}

export function isReplacingType(type: AnnotationType): boolean {
  return REPLACING_TYPES.has(type);
}

export function canFire(type: AnnotationType): boolean {
  return REPLACING_TYPES.has(type) || PERSISTING_TYPES.has(type);
}
