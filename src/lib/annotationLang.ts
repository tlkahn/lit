/**
 * Segmentation-language resolution for annotations, mirroring
 * `src-tauri/src/annotation/lang.rs`.
 *
 * An annotation's sentence scope depends on which language's rules the body is
 * segmented with, so index time (Rust) and live preview (here) must agree on
 * one answer. The language is a three-scope setting resolved with precedence
 * **annotation > document > app-global**:
 *
 * | Scope      | Mechanism                                            |
 * |------------|------------------------------------------------------|
 * | Annotation | DSL field: `lang=fr` (compact) / `lang: fr` (block)  |
 * | Document   | frontmatter `annotation-lang`, else pandoc's `lang`  |
 * | Global     | preference `annotations.defaultLang` (default `en`)  |
 *
 * The normalization table here and in `lang.rs` must stay identical (#854).
 */

import scriptTags from "./annotationLangScripts.json";

/** Fallback when nothing in the three scopes yields a usable tag. */
export const DEFAULT_ANNOTATION_LANG = "en";

const KNOWN_SCRIPT_TAGS: ReadonlySet<string> = new Set(scriptTags);

/**
 * Canonicalizes a raw language tag into the form `sentencex` expects, or
 * `null` when it is empty or malformed.
 *
 * Lowercases, and drops BCP-47 *region* subtags (2 alpha or 3 digits) while
 * keeping *script* subtags only when the combined `primary-script` tag is
 * known to sentencex's fallback table: `zh-CN` -> `zh`, `en-US` -> `en`,
 * `zh-Hant` -> `zh-hant`, but `ru-Latn` -> `ru` (not in the table).
 */
export function normalizeLang(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const lowered = raw.trim().toLowerCase();
  if (lowered === "") return null;

  const subtags = lowered.split(/[-_]/);
  const primary = subtags[0] ?? "";
  if (!/^[a-z]{2,3}$/.test(primary)) return null;

  const script = subtags.slice(1).find((s) => /^[a-z]{4}$/.test(s));
  if (script) {
    const combined = `${primary}-${script}`;
    if (KNOWN_SCRIPT_TAGS.has(combined)) return combined;
  }
  return primary;
}

/**
 * Document-scope language from frontmatter: the namespaced `annotation-lang`
 * key first, then pandoc's generic `lang`.
 */
export function frontmatterLang(
  fm: Record<string, unknown> | null | undefined,
): string | null {
  if (!fm || typeof fm !== "object") return null;
  for (const key of ["annotation-lang", "lang"]) {
    const normalized = normalizeLang(
      typeof fm[key] === "string" ? (fm[key] as string) : null,
    );
    if (normalized) return normalized;
  }
  return null;
}

/**
 * Resolves the three scopes in precedence order, falling back to
 * {@link DEFAULT_ANNOTATION_LANG}. A garbage value at one scope falls through
 * to the next rather than poisoning the result.
 */
export function effectiveAnnotationLang(
  annLang: string | null | undefined,
  frontmatter: Record<string, unknown> | null | undefined,
  globalDefault: string | null | undefined,
): string {
  return (
    normalizeLang(annLang) ??
    frontmatterLang(frontmatter) ??
    normalizeLang(globalDefault) ??
    DEFAULT_ANNOTATION_LANG
  );
}
