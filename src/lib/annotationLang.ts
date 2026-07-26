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

/** Fallback when nothing in the three scopes yields a usable tag. */
export const DEFAULT_ANNOTATION_LANG = "en";

/**
 * Canonicalizes a raw language tag into the form `sentencex` expects, or
 * `null` when it is empty or malformed.
 *
 * Lowercases, and drops BCP-47 *region* subtags (2 alpha or 3 digits) while
 * keeping *script* subtags: `zh-CN` -> `zh`, `en-US` -> `en`, `fr-CA` -> `fr`,
 * `zh-Hant` -> `zh-hant`. Dropping the region matters because `sentencex`
 * falls through unknown tags to `en`, and its fallback table knows
 * `zh-hant`/`zh-hans` but not `zh-cn`.
 */
export function normalizeLang(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const lowered = raw.trim().toLowerCase();
  if (lowered === "") return null;

  const subtags = lowered.split(/[-_]/);
  const primary = subtags[0] ?? "";
  if (!/^[a-z]{2,3}$/.test(primary)) return null;

  // Only a script subtag survives; regions and variants are dropped because
  // `sentencex` keys its fallback table on language and script alone.
  const script = subtags.slice(1).find((s) => /^[a-z]{4}$/.test(s));
  return script ? `${primary}-${script}` : primary;
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
