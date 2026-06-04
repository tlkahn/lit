import type { AnnotationType, Certainty } from "./ipc";

export const BUILDER_SCOPE_KINDS = ["none", "words", "sentence", "paragraph", "page", "anchor", "document", "section"] as const;
export type BuilderScopeKind = (typeof BUILDER_SCOPE_KINDS)[number];

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
const VALID_SCOPE_KINDS: ReadonlySet<string> = new Set(BUILDER_SCOPE_KINDS);

export function isValidBuilderDefaults(v: unknown): v is AnnotationBuilderDefaults {
  if (v == null || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  if (obj.type !== null && (typeof obj.type !== "string" || !VALID_TYPES.has(obj.type))) return false;
  if (typeof obj.certainty !== "string" || !VALID_CERTAINTIES.has(obj.certainty)) return false;
  if (typeof obj.scopeKind !== "string" || !VALID_SCOPE_KINDS.has(obj.scopeKind)) return false;
  if (typeof obj.scopeCount !== "number" || obj.scopeCount < 1 || !Number.isFinite(obj.scopeCount)) return false;
  if (typeof obj.asymmetric !== "boolean") return false;
  if (typeof obj.scopeAfter !== "number" || obj.scopeAfter < 1 || !Number.isFinite(obj.scopeAfter)) return false;
  return true;
}
