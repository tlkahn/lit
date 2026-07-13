import type { KatexOptions } from "katex";

/**
 * Static substitution table for plain TeX primitives that KaTeX doesn't
 * implement, applied via KaTeX's `macros` option so old papers and arXiv
 * sources render instead of erroring. User-level `\def`s in a document
 * still override these (macros passed here act as pre-defined macros).
 */

const SIZE_PREFIXES = [
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
] as const;

// Plain TeX font switches KaTeX supports, keyed by the plain TeX suffix.
// \sl (slanted) and \mit (math italic) have no KaTeX equivalent; italic
// is the closest rendering.
const FONT_SUFFIXES: Record<string, string> = {
  rm: "\\rm",
  bf: "\\bf",
  it: "\\it",
  sl: "\\it",
  tt: "\\tt",
  sf: "\\sf",
};

function buildMacros(): Record<string, string> {
  const macros: Record<string, string> = {};
  for (const size of SIZE_PREFIXES) {
    for (const [suffix, replacement] of Object.entries(FONT_SUFFIXES)) {
      macros[`\\${size}${suffix}`] = replacement;
    }
  }
  macros["\\sl"] = "\\it";
  macros["\\mit"] = "\\it";
  macros["\\boldmath"] = "\\bf";
  macros["\\unboldmath"] = "\\rm";
  macros["\\vbox"] = "\\hbox";
  macros["\\eqalign"] = "\\begin{aligned}#1\\end{aligned}";
  // Plain TeX \pmatrix{a&b\cr c&d}; the \begin{pmatrix} environment is
  // unaffected because environments resolve before macro expansion.
  macros["\\pmatrix"] = "\\begin{pmatrix}#1\\end{pmatrix}";
  macros["\\undertext"] = "\\underline";
  return macros;
}

export const LATEX_COMPAT_MACROS: Readonly<Record<string, string>> =
  Object.freeze(buildMacros());

/**
 * Standard options for every KaTeX render call. Returns a fresh `macros`
 * object each time: KaTeX writes user `\def`/`\gdef` definitions into the
 * passed object, and sharing one would leak definitions across renders.
 */
export function katexOptions(displayMode: boolean): KatexOptions {
  return {
    throwOnError: false,
    displayMode,
    macros: { ...LATEX_COMPAT_MACROS },
  };
}
