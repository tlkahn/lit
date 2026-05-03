import type { Annotation, AnnotationType, Certainty, Scope } from "./ipc";

export interface AnnotationFields {
  type: AnnotationType | null;
  certainty: Certainty;
  scope: Scope | null;
  body: string;
  date: string | null;
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

const EXPLICIT_SCOPE_RE = /[_\\]|^\^"/;

export function annotationToFields(ann: Annotation): AnnotationFields {
  const type: AnnotationType | null = ann.annotation_type === "bare" ? null : ann.annotation_type;
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

  return { type, certainty, scope, body, date };
}

const TYPE_KEYWORDS: Record<string, string> = {
  note: "n",
  question: "q",
  todo: "todo",
  crossref: "cf",
  apparatus: "app",
  translation: "tr",
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
  }
}

function isBlockForm(body: string): boolean {
  return body.includes("\n") || body.length > 80;
}

export function generateDsl(fields: AnnotationFields): string {
  const { type, certainty, scope, body, date } = fields;

  const typeStr = serializeType(type);
  const certStr = serializeCertainty(certainty);
  const scopeStr = serializeScope(scope);
  const dateStr = date ? `@${date}` : "";

  if (body && isBlockForm(body)) {
    return generateBlock(typeStr, certStr, scopeStr, dateStr, body);
  }

  return generateCompact(typeStr, certStr, scopeStr, dateStr, body);
}

function generateCompact(
  typeStr: string,
  certStr: string,
  scopeStr: string,
  dateStr: string,
  body: string,
): string {
  const typeCert = typeStr + certStr;

  const headerParts: string[] = [];
  if (typeCert) headerParts.push(typeCert);
  if (scopeStr) headerParts.push(scopeStr);

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

  return `%%! ${inner} %%`;
}

function generateBlock(
  typeStr: string,
  certStr: string,
  scopeStr: string,
  dateStr: string,
  body: string,
): string {
  const lines: string[] = ["%%!"];

  const typeCert = typeStr + certStr;
  if (typeCert) lines.push(typeCert);
  if (scopeStr) lines.push(scopeStr);
  if (dateStr) lines.push(dateStr);

  if (body) {
    lines.push("---");
    lines.push(body);
  }

  lines.push("%%");
  return lines.join("\n");
}
