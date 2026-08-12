import type { Annotation, AnnotationType, Certainty, Scope } from "./ipc";
import { normalizeLang } from "./annotationLang";

export interface AnnotationFields {
  id: string | null;
  type: AnnotationType | null;
  mark?: string;
  certainty: Certainty;
  scope: Scope | null;
  body: string;
  date: string | null;
  /** Segmentation language; `null`/empty means "inherit" and emits nothing. */
  lang: string | null;
}

export interface AnnotationBuilderEventDetail {
  mode: "create" | "edit";
  annotation?: Annotation;
  originalRange?: { from: number; to: number };
  selectedText?: string;
}

export interface EditRawInfo {
  mode: "create" | "edit";
  draftDsl: string;
  originalRange?: { from: number; to: number };
}

export function getEditCursorOffset(dsl: string): number {
  if (dsl.startsWith("<!---[")) {
    const closeBracket = dsl.indexOf("]", 5);
    if (closeBracket !== -1) {
      if (dsl[closeBracket + 1] === "\n") {
        const separatorIdx = dsl.indexOf("\n---\n");
        if (separatorIdx !== -1) return separatorIdx + 5;
        return closeBracket + 2;
      }
      return closeBracket + 2;
    }
  }
  if (dsl.startsWith("<!---\n")) {
    const separatorIdx = dsl.indexOf("\n---\n");
    if (separatorIdx !== -1) {
      return separatorIdx + 5;
    }
    return 6;
  }
  return 6;
}

const EXPLICIT_SCOPE_RE = /[_\\]/;

export function annotationToFields(ann: Annotation): AnnotationFields {
  const hasAuthoredId = /^(?:<!---\s*\[|%%!\s*\[)/.test(ann.original);
  const id = hasAuthoredId ? (ann.uuid ?? null) : null;
  // Legacy `llm` markers open as Note in the builder so Save re-emits `n`
  // (no bulk on-disk rewrite; only edited annotations change).
  const rawType =
    ann.annotation_type === "llm" ? "note" : ann.annotation_type;
  const type: AnnotationType | null =
    rawType === "bare" || rawType === "mark" ? null : rawType;
  const mark = ann.annotation_type === "mark" ? (ann.mark ?? undefined) : undefined;
  const certainty: Certainty = ann.certainty;

  let scope: Scope | null;
  if (
    ann.scope.kind === "sentence" &&
    ann.scope.value === 1 &&
    !EXPLICIT_SCOPE_RE.test(ann.original)
  ) {
    scope = null;
  } else {
    scope = ann.scope;
  }

  const body = ann.body ?? "";
  const date = ann.date ?? null;
  const lang = ann.lang ?? null;

  return { id, type, mark, certainty, scope, body, date, lang };
}

const TYPE_KEYWORDS: Record<string, string> = {
  note: "n",
  question: "q",
  todo: "todo",
  crossref: "cf",
  apparatus: "app",
  translation: "tr",
  // Legacy `llm` keyword is intentionally absent: lit treats it as Note
  // (normalizeLegacyAnnotationType) and nothing new emits `llm`.
  thread: "th",
  slipnote: "sn",
};

function serializeType(type: AnnotationType | null): string {
  if (type === null || type === "bare") return "";
  return TYPE_KEYWORDS[type] ?? "";
}

function serializeCertainty(certainty: Certainty): string {
  if (certainty === "tentative") return "?";
  if (certainty === "firm") return "!";
  return "";
}

function serializeScope(scope: Scope | null): string {
  if (scope === null) return "";
  switch (scope.kind) {
    case "words":
      return "_".repeat(scope.value);
    case "sentence":
      return "\\s" + "s".repeat(scope.value - 1);
    case "paragraph":
      return "\\p" + "p".repeat(scope.value - 1);
    case "page":
      return "\\f" + "f".repeat(scope.value - 1);
    case "anchor": {
      const escaped = scope.value.replace(/"/g, '\\"');
      return `^"${escaped}"`;
    }
    case "document":
      return "\\d";
    case "section":
      return "\\h";
    case "asymmetric": {
      if (scope.value.unit === "word") {
        return `${scope.value.before}_${scope.value.after}`;
      }
      const unitMap: Record<string, string> = { sentence: "s", paragraph: "p", page: "f" };
      const u = unitMap[scope.value.unit] ?? "s";
      return `${scope.value.before}\\${u}${scope.value.after}`;
    }
  }
}

export type AnnotationForm = "inline" | "block";

export function generateDsl(
  fields: AnnotationFields,
  opts?: { form?: AnnotationForm },
): string {
  const { id, type, mark, certainty, scope, body, date, lang } = fields;

  const idStr = id ? `[${id}]` : "";
  const typeStr = mark ? mark : serializeType(type);
  const certStr = serializeCertainty(certainty);
  const scopeStr = serializeScope(scope);
  const dateStr = date ? `@${date}` : "";
  const langStr = lang ? (normalizeLang(lang) ?? "") : "";

  // A body with a newline can never fit the inline grammar, regardless of caller intent.
  const form: AnnotationForm =
    body.includes("\n") ? "block" : (opts?.form ?? "inline");

  if (body && form === "block") {
    return generateBlock(idStr, typeStr, certStr, scopeStr, langStr, dateStr, body);
  }

  return generateCompact(idStr, typeStr, certStr, scopeStr, langStr, dateStr, body);
}

function generateCompact(
  idStr: string,
  typeStr: string,
  certStr: string,
  scopeStr: string,
  langStr: string,
  dateStr: string,
  body: string,
): string {
  const typeCert = typeStr + certStr;

  const headerParts: string[] = [];
  if (typeCert) headerParts.push(typeCert);
  if (scopeStr) headerParts.push(scopeStr);
  if (langStr) headerParts.push(`lang=${langStr}`);

  const tailParts: string[] = [];
  if (body) tailParts.push(body);
  if (dateStr) tailParts.push(dateStr);

  const tailStr = tailParts.join(" ");

  let inner: string;
  if (headerParts.length > 0 && body) {
    inner = headerParts.join(" ") + " | " + tailStr;
  } else if (headerParts.length > 0 && tailStr) {
    inner = headerParts.join(" ") + " " + tailStr;
  } else if (headerParts.length > 0) {
    inner = headerParts.join(" ");
  } else {
    inner = tailStr;
  }

  if (idStr) {
    return `<!---${idStr} ${inner} --->`;
  }
  return `<!--- ${inner} --->`;
}

function generateBlock(
  idStr: string,
  typeStr: string,
  certStr: string,
  scopeStr: string,
  langStr: string,
  dateStr: string,
  body: string,
): string {
  const lines: string[] = [idStr ? `<!---${idStr}` : "<!---"];

  const typeCert = typeStr + certStr;
  if (typeCert) lines.push(typeCert);
  if (scopeStr) lines.push(scopeStr);
  if (langStr) lines.push(`lang: ${langStr}`);
  if (dateStr) lines.push(dateStr);

  if (body) {
    lines.push("---");
    lines.push(body);
  }

  lines.push("--->");
  return lines.join("\n");
}
