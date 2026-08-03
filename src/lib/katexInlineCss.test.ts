import { describe, it, expect } from "vitest";
import { stripKatexFontFaces, KATEX_INLINE_CSS } from "./katexInlineCss";

describe("stripKatexFontFaces", () => {
  it("removes a single @font-face block", () => {
    const input = `@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main.woff2)}
.katex{font:normal 1.21em KaTeX_Main}`;
    const result = stripKatexFontFaces(input);
    expect(result).not.toContain("@font-face");
    expect(result).toContain(".katex");
  });

  it("removes consecutive minified @font-face blocks", () => {
    const input =
      '@font-face{font-family:KaTeX_Main;src:url(fonts/a.woff2)}@font-face{font-family:KaTeX_Math;src:url(fonts/b.woff2)}.katex{color:red}';
    const result = stripKatexFontFaces(input);
    expect(result).not.toContain("@font-face");
    expect(result).toContain(".katex{color:red}");
  });

  it("keeps rules that follow @font-face blocks", () => {
    const input =
      "@font-face{font-family:X;src:url(fonts/x.woff2)}.after{margin:0}";
    const result = stripKatexFontFaces(input);
    expect(result).toContain(".after{margin:0}");
  });

  it("output has no url(fonts/ references", () => {
    const input =
      '@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2")}.katex{display:block}';
    const result = stripKatexFontFaces(input);
    expect(result).not.toContain("url(fonts/");
  });
});

describe("KATEX_INLINE_CSS", () => {
  it("contains .katex", () => {
    expect(KATEX_INLINE_CSS).toContain(".katex");
  });

  it("is longer than 1000 characters", () => {
    expect(KATEX_INLINE_CSS.length).toBeGreaterThan(1000);
  });

  it("has no @font-face blocks", () => {
    expect(KATEX_INLINE_CSS).not.toContain("@font-face");
  });

  it("has no url(fonts/ references", () => {
    expect(KATEX_INLINE_CSS).not.toContain("url(fonts/");
  });
});
