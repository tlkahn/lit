import katexCssRaw from "katex/dist/katex.min.css?raw";

export function stripKatexFontFaces(css: string): string {
  return css.replace(/@font-face\s*\{[^}]*\}/g, "");
}

export const KATEX_INLINE_CSS: string = stripKatexFontFaces(katexCssRaw);
