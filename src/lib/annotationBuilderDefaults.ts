import type { AnnotationType, Certainty } from "./ipc";

export type BuilderScopeKind = "none" | "words" | "sentence" | "paragraph" | "page" | "anchor" | "document" | "section";

export interface AnnotationBuilderDefaults {
  type: AnnotationType | null;
  certainty: Certainty;
  scopeKind: BuilderScopeKind;
  scopeCount: number;
  asymmetric: boolean;
  scopeAfter: number;
}

const VALID_TYPES = new Set<string>(["note", "question", "todo", "crossref", "apparatus", "translation", "llm", "bare"]);
const VALID_CERTAINTIES = new Set<string>(["tentative", "firm", "neutral"]);
const VALID_SCOPE_KINDS = new Set<string>(["none", "words", "sentence", "paragraph", "page", "anchor", "document", "section"]);

export function isValidBuilderDefaults(v: unknown): v is AnnotationBuilderDefaults {
  if (v == null || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  if (obj.type !== null && (typeof obj.type !== "string" || !VALID_TYPES.has(obj.type))) return false;
  if (typeof obj.certainty !== "string" || !VALID_CERTAINTIES.has(obj.certainty)) return false;
  if (typeof obj.scopeKind !== "string" || !VALID_SCOPE_KINDS.has(obj.scopeKind)) return false;
  if (typeof obj.scopeCount !== "number") return false;
  if (typeof obj.asymmetric !== "boolean") return false;
  if (typeof obj.scopeAfter !== "number") return false;
  return true;
}
