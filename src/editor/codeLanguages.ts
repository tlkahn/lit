import { languages } from "@codemirror/language-data";
import { LanguageDescription, LanguageSupport } from "@codemirror/language";
import { bibtex } from "./bibtex";
import { basename } from "../lib/pathUtils";

const bibtexDescription = LanguageDescription.of({
  name: "BibTeX",
  extensions: ["bib"],
  load: async () => bibtex(),
});

// BibTeX must come first so matchFilename prefers our custom descriptor over
// any future language-data collision on the `.bib` extension.
const allLanguages: LanguageDescription[] = [bibtexDescription, ...languages];

export function resolveLanguage(filename: string): LanguageDescription | null {
  return LanguageDescription.matchFilename(allLanguages, basename(filename));
}

export async function loadLanguage(
  filename: string,
): Promise<LanguageSupport | null> {
  const desc = resolveLanguage(filename);
  if (!desc) return null;
  // LanguageDescription.load() caches the result into `.support`.
  return desc.support ?? (await desc.load());
}
