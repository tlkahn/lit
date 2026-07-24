// Intentionally broader than citeproc's full key grammar: this only checks
// whether the bracket text looks like a citation (contains @), not whether the
// keys are valid citeproc identifiers. This is deliberate - false positives
// (bracket text with @ that isn't a real citation) should be styled as
// citations, not neutralized as plain text.
const CITE_BRACKET_ANCHORED_RE = /^\[([^\]]*@[^\]]+)\]$/;

export function isCitationBracket(text: string): boolean {
  return CITE_BRACKET_ANCHORED_RE.test(text);
}
