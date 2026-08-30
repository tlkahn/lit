import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { EditorState } from "@codemirror/state";
import { livePreviewBaseTheme, livePreviewThemeSpec } from "./theme";

describe("livePreviewBaseTheme", () => {
  it("is a valid Extension that can be added to EditorState", () => {
    expect(() =>
      EditorState.create({ extensions: [livePreviewBaseTheme] }),
    ).not.toThrow();
  });
});

describe("heading theme spec", () => {
  it(".cm-preview-h1..h4 keep heading font sizes from #897", () => {
    expect((livePreviewThemeSpec[".cm-preview-h1"] as Record<string, string>).fontSize).toBe("1.5em");
    expect((livePreviewThemeSpec[".cm-preview-h2"] as Record<string, string>).fontSize).toBe("1.3em");
    expect((livePreviewThemeSpec[".cm-preview-h3"] as Record<string, string>).fontSize).toBe("1.15em");
    expect((livePreviewThemeSpec[".cm-preview-h4"] as Record<string, string>).fontSize).toBe("1.05em");
  });

  it("neutralizes nested tok-heading em inside preview heading marks", () => {
    expect((livePreviewThemeSpec[".cm-preview-h1 .tok-heading1"] as Record<string, string>).fontSize).toBe("1em");
    expect((livePreviewThemeSpec[".cm-preview-h2 .tok-heading2"] as Record<string, string>).fontSize).toBe("1em");
    expect((livePreviewThemeSpec[".cm-preview-h3 .tok-heading3"] as Record<string, string>).fontSize).toBe("1em");
    expect((livePreviewThemeSpec[".cm-preview-h4 .tok-heading4"] as Record<string, string>).fontSize).toBe("1em");
  });

  it("forces katex to 1em so it inherits surrounding preview scale", () => {
    const rule = livePreviewThemeSpec[
      ".cm-preview-math-inline .katex, .cm-preview-math-display .katex"
    ] as Record<string, string>;
    expect(rule.fontSize).toBe("1em");
  });
});

describe("math text-indent locks (#1046)", () => {
  it("resets text-indent on inline math so list hanging indent cannot clip KaTeX (#1046)", () => {
    const rule = livePreviewThemeSpec[".cm-preview-math-inline"] as Record<string, string>;
    expect(rule.textIndent).toBe("0");
  });

  it("resets text-indent on display math (#1046 sibling shield)", () => {
    const rule = livePreviewThemeSpec[".cm-preview-math-display"] as Record<string, string>;
    expect(rule.textIndent).toBe("0");
  });
});

describe("crossref CSS variables in variables.css", () => {
  const css = readFileSync(
    resolve(__dirname, "../../themes/variables.css"),
    "utf-8",
  );

  const expectedVars = [
    "--crossref-citation-color",
    "--crossref-definition-color",
    "--crossref-citeproc-color",
    "--crossref-invalid-color",
    "--crossref-highlight-color",
  ];

  for (const varName of expectedVars) {
    it(`defines ${varName} in .theme-light`, () => {
      const lightBlock = css.split(".theme-dark")[0];
      expect(lightBlock).toContain(varName);
    });

    it(`defines ${varName} in .theme-dark`, () => {
      const darkBlock = css.split(".theme-dark")[1];
      expect(darkBlock).toContain(varName);
    });
  }
});

describe("thumbnail theme spec", () => {
  it("livePreviewThemeSpec contains .cm-preview-image-thumbnail key", () => {
    expect(livePreviewThemeSpec[".cm-preview-image-thumbnail"]).toBeDefined();
  });

  it("livePreviewThemeSpec contains .cm-preview-mermaid--thumbnail key", () => {
    expect(livePreviewThemeSpec[".cm-preview-mermaid--thumbnail"]).toBeDefined();
  });
});

describe("horizontal rule theme spec", () => {
  it("livePreviewThemeSpec contains .cm-preview-hr key", () => {
    expect(livePreviewThemeSpec[".cm-preview-hr"]).toBeDefined();
  });

  it(".cm-preview-hr uses height 1lh to match text line height", () => {
    const rule = livePreviewThemeSpec[".cm-preview-hr"] as Record<string, string>;
    expect(rule.border).toBe("none");
    expect(rule.height).toBe("1lh");
  });

  it(".cm-preview-hr draws centered 1px line via background", () => {
    const rule = livePreviewThemeSpec[".cm-preview-hr"] as Record<string, string>;
    expect(rule.backgroundSize).toBe("100% 1px");
    expect(rule.backgroundPosition).toBe("center");
  });

  it("livePreviewThemeSpec contains .cm-preview-hr.cm-preview-hr-short key", () => {
    expect(livePreviewThemeSpec[".cm-preview-hr.cm-preview-hr-short"]).toBeDefined();
  });

  it(".cm-preview-hr-short uses 2lh height and 25% background width", () => {
    const rule = livePreviewThemeSpec[".cm-preview-hr.cm-preview-hr-short"] as Record<string, string>;
    expect(rule.height).toBe("2lh");
    expect(rule.backgroundSize).toBe("25% 1px");
    expect(rule.opacity).toBe("0.6");
  });
});

describe("page break theme spec", () => {
  it("livePreviewThemeSpec contains .cm-preview-page-break key", () => {
    expect(livePreviewThemeSpec[".cm-preview-page-break"]).toBeDefined();
  });

  it(".cm-preview-page-break has height 1lh", () => {
    const rule = livePreviewThemeSpec[".cm-preview-page-break"] as Record<string, string>;
    expect(rule.height).toBe("1lh");
  });

  it(".cm-preview-page-break has display flex", () => {
    const rule = livePreviewThemeSpec[".cm-preview-page-break"] as Record<string, string>;
    expect(rule.display).toBe("flex");
  });

  it(".cm-preview-page-break-label has fontSize 12px", () => {
    const rule = livePreviewThemeSpec[".cm-preview-page-break-label"] as Record<string, string>;
    expect(rule.fontSize).toBe("12px");
  });

  it(".cm-preview-page-break-rule key exists", () => {
    expect(livePreviewThemeSpec[".cm-preview-page-break-rule"]).toBeDefined();
  });
});

describe("inline code theme spec", () => {
  it(".cm-preview-code-inline has no fontSize to avoid size changes on toggle", () => {
    const rule = livePreviewThemeSpec[".cm-preview-code-inline"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule).not.toHaveProperty("fontSize");
  });
});

describe("monospace size scaling (#1059)", () => {
  const ratioFontSize = "calc(var(--font-monospace-size-ratio, 0.875) * 1em)";

  it(".cm-preview-code-block scales via the ratio with no margin", () => {
    const rule = livePreviewThemeSpec[".cm-preview-code-block"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule.fontSize).toBe(ratioFontSize);
    expect(rule).not.toHaveProperty("margin");
  });

  it(".cm-code-fence-top scales via the ratio and uses the mono family", () => {
    const rule = livePreviewThemeSpec[".cm-code-fence-top"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule.fontSize).toBe(ratioFontSize);
    expect(rule.fontFamily).toContain("--font-monospace-theme");
    expect(rule).not.toHaveProperty("margin");
  });

  it(".cm-code-fence-bottom scales via the ratio and uses the mono family", () => {
    const rule = livePreviewThemeSpec[".cm-code-fence-bottom"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule.fontSize).toBe(ratioFontSize);
    expect(rule.fontFamily).toContain("--font-monospace-theme");
    expect(rule).not.toHaveProperty("margin");
  });

  it(".cm-preview-code-block .tok-monospace neutralizes double scaling", () => {
    const rule = livePreviewThemeSpec[".cm-preview-code-block .tok-monospace"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule.fontSize).toBe("1em");
  });
});

describe("strikethrough theme spec", () => {
  it("livePreviewThemeSpec contains .cm-preview-strikethrough key", () => {
    expect(livePreviewThemeSpec[".cm-preview-strikethrough"]).toBeDefined();
  });

  it(".cm-preview-strikethrough has line-through text decoration", () => {
    const rule = livePreviewThemeSpec[".cm-preview-strikethrough"] as Record<string, string>;
    expect(rule.textDecoration).toBe("line-through");
  });
});

describe("inline HTML sup/sub/mark theme spec", () => {
  it("livePreviewThemeSpec contains .cm-preview-sup key", () => {
    expect(livePreviewThemeSpec[".cm-preview-sup"]).toBeDefined();
  });

  it(".cm-preview-sup is superscript with smaller font (matches .cm-footnote-ref metrics)", () => {
    const rule = livePreviewThemeSpec[".cm-preview-sup"] as Record<string, string>;
    expect(rule.verticalAlign).toBe("super");
    expect(rule.fontSize).toBe("0.75em");
    expect(rule).not.toHaveProperty("margin");
  });

  it("livePreviewThemeSpec contains .cm-preview-sub key", () => {
    expect(livePreviewThemeSpec[".cm-preview-sub"]).toBeDefined();
  });

  it(".cm-preview-sub is subscript with smaller font", () => {
    const rule = livePreviewThemeSpec[".cm-preview-sub"] as Record<string, string>;
    expect(rule.verticalAlign).toBe("sub");
    expect(rule.fontSize).toBe("0.75em");
    expect(rule).not.toHaveProperty("margin");
  });

  it("livePreviewThemeSpec contains .cm-preview-mark key", () => {
    expect(livePreviewThemeSpec[".cm-preview-mark"]).toBeDefined();
  });

  it(".cm-preview-mark has a translucent accent background and no margin", () => {
    const rule = livePreviewThemeSpec[".cm-preview-mark"] as Record<string, string>;
    expect(rule.backgroundColor).toContain("color-mix");
    expect(rule).not.toHaveProperty("margin");
  });
});

describe("escaped dollar theme spec", () => {
  it("livePreviewThemeSpec contains .cm-preview-escaped-dollar key", () => {
    expect(livePreviewThemeSpec[".cm-preview-escaped-dollar"]).toBeDefined();
  });

  it(".cm-preview-escaped-dollar has no margin or fontSize (no layout jump on reveal)", () => {
    const rule = livePreviewThemeSpec[".cm-preview-escaped-dollar"] as Record<string, string>;
    expect(rule).not.toHaveProperty("margin");
    expect(rule).not.toHaveProperty("fontSize");
  });

  it(".cm-preview-escaped-dollar locks color inherit as the neutral contract", () => {
    const rule = livePreviewThemeSpec[".cm-preview-escaped-dollar"] as Record<string, string>;
    expect(rule.color).toBe("inherit");
  });
});

describe("footnote definition theme spec", () => {
  it("livePreviewThemeSpec contains .cm-footnote-def key", () => {
    expect(livePreviewThemeSpec[".cm-footnote-def"]).toBeDefined();
  });

  it(".cm-footnote-def uses border-inline-start and padding only (no margin, no color)", () => {
    const rule = livePreviewThemeSpec[".cm-footnote-def"] as Record<string, string>;
    expect(rule.borderInlineStart).toContain("var(--text-faint)");
    expect(rule.paddingLeft).toBe("8px");
    expect(rule).not.toHaveProperty("margin");
    expect(rule).not.toHaveProperty("color");
  });

  it("livePreviewThemeSpec contains .cm-footnote-def-mark key", () => {
    expect(livePreviewThemeSpec[".cm-footnote-def-mark"]).toBeDefined();
  });

  it(".cm-footnote-def-mark is accent, semibold, padding-right only (no margin)", () => {
    const rule = livePreviewThemeSpec[".cm-footnote-def-mark"] as Record<string, string>;
    expect(rule.color).toBe("var(--text-accent)");
    expect(rule.fontWeight).toBe("600");
    expect(rule.paddingRight).toBe("0.35em");
    expect(rule).not.toHaveProperty("margin");
  });

  it("livePreviewThemeSpec contains .cm-footnote-def-body key", () => {
    expect(livePreviewThemeSpec[".cm-footnote-def-body"]).toBeDefined();
  });

  it(".cm-footnote-def-body is block with padding only (no margin)", () => {
    const rule = livePreviewThemeSpec[".cm-footnote-def-body"] as Record<string, string>;
    expect(rule.display).toBe("block");
    expect(rule.paddingTop).toBeDefined();
    expect(rule.paddingBottom).toBeDefined();
    expect(rule).not.toHaveProperty("margin");
  });

  it(".cm-footnote-def-body paragraphs use zero margin (padding separation)", () => {
    const p = livePreviewThemeSpec[".cm-footnote-def-body p"] as Record<string, string>;
    expect(p.margin).toBe("0");
    const pPlusP = livePreviewThemeSpec[".cm-footnote-def-body p + p"] as Record<string, string>;
    expect(pPlusP.paddingTop).toBeDefined();
    expect(pPlusP).not.toHaveProperty("margin");
  });

  it(".cm-footnote-def-body headings are compact and use padding, not margin", () => {
    const headings = livePreviewThemeSpec[".cm-footnote-def-body h1, .cm-footnote-def-body h2, .cm-footnote-def-body h3, .cm-footnote-def-body h4, .cm-footnote-def-body h5, .cm-footnote-def-body h6"] as Record<string, string>;
    expect(headings.fontWeight).toBe("600");
    expect(headings.paddingTop).toBeDefined();
    expect(headings.paddingBottom).toBeDefined();
    expect(headings).not.toHaveProperty("margin");
  });

  it(".cm-footnote-def-body lists use zero margin (UA margins would inflate estimatedHeight)", () => {
    const key = ".cm-footnote-def-body ul, .cm-footnote-def-body ol";
    const rule = livePreviewThemeSpec[key] as Record<string, string>;
    expect(rule, key).toBeDefined();
    expect(rule.margin).toBe("0");
    expect(rule).not.toHaveProperty("marginTop");
  });

  it(".cm-footnote-def-body list items use zero margin", () => {
    const key = ".cm-footnote-def-body li";
    const rule = livePreviewThemeSpec[key] as Record<string, string>;
    expect(rule, key).toBeDefined();
    expect(rule.margin).toBe("0");
    expect(rule).not.toHaveProperty("marginTop");
  });

  it(".cm-footnote-def-body blockquote uses zero margin", () => {
    const key = ".cm-footnote-def-body blockquote";
    const rule = livePreviewThemeSpec[key] as Record<string, string>;
    expect(rule, key).toBeDefined();
    expect(rule.margin).toBe("0");
    expect(rule).not.toHaveProperty("marginTop");
  });

  it(".cm-footnote-def-body pre uses zero margin", () => {
    const key = ".cm-footnote-def-body pre";
    const rule = livePreviewThemeSpec[key] as Record<string, string>;
    expect(rule, key).toBeDefined();
    expect(rule.margin).toBe("0");
    expect(rule).not.toHaveProperty("marginTop");
  });

  it(".cm-footnote-def-body table uses zero margin", () => {
    const key = ".cm-footnote-def-body table";
    const rule = livePreviewThemeSpec[key] as Record<string, string>;
    expect(rule, key).toBeDefined();
    expect(rule.margin).toBe("0");
    expect(rule).not.toHaveProperty("marginTop");
  });

  it("livePreviewThemeSpec contains .cm-footnote-backref key", () => {
    expect(livePreviewThemeSpec[".cm-footnote-backref"]).toBeDefined();
  });

  it(".cm-footnote-backref uses accent color, pointer cursor, padding only (no margin)", () => {
    const rule = livePreviewThemeSpec[".cm-footnote-backref"] as Record<string, string>;
    expect(rule.color).toBe("var(--text-accent)");
    expect(rule.cursor).toBe("pointer");
    expect(rule.paddingLeft).toBeDefined();
    expect(rule).not.toHaveProperty("margin");
  });

  it(".cm-footnote-backref disables text selection", () => {
    const rule = livePreviewThemeSpec[".cm-footnote-backref"] as Record<string, string>;
    expect(rule.userSelect).toBe("none");
  });

  it("has a .cm-footnote-backref:hover rule", () => {
    const rule = livePreviewThemeSpec[".cm-footnote-backref:hover"] as Record<string, string>;
    expect(rule).toBeDefined();
  });
});

describe("blockquote theme spec", () => {
  it("livePreviewThemeSpec contains .cm-blockquote key", () => {
    expect(livePreviewThemeSpec[".cm-blockquote"]).toBeDefined();
  });

  it(".cm-blockquote has border-inline-start", () => {
    const rule = livePreviewThemeSpec[".cm-blockquote"] as Record<string, string>;
    expect(rule.borderInlineStart).toBeDefined();
  });

  it("overrides lezer quote styling in blockquote lines", () => {
    expect(livePreviewThemeSpec["& .cm-line.cm-blockquote span"]).toBeDefined();
  });

  it("preserves italic inside blockquote", () => {
    expect(livePreviewThemeSpec["& .cm-line.cm-blockquote .cm-preview-italic"]).toBeDefined();
  });
});

describe("crossref theme spec", () => {
  it("exports livePreviewThemeSpec as an object", () => {
    expect(typeof livePreviewThemeSpec).toBe("object");
    expect(livePreviewThemeSpec).not.toBeNull();
  });

  it(".cm-crossref-citation uses --crossref-citation-color", () => {
    const rule = livePreviewThemeSpec[".cm-crossref-citation"] as Record<string, string>;
    expect(rule.color).toContain("--crossref-citation-color");
  });

  it(".cm-crossref-definition uses --crossref-definition-color", () => {
    const rule = livePreviewThemeSpec[".cm-crossref-definition"] as Record<string, string>;
    expect(rule.color).toContain("--crossref-definition-color");
  });

  it(".cm-crossref-citeproc uses --crossref-citeproc-color", () => {
    const rule = livePreviewThemeSpec[".cm-crossref-citeproc"] as Record<string, string>;
    expect(rule.color).toContain("--crossref-citeproc-color");
  });

  it(".cm-crossref-citation.invalid uses --crossref-invalid-color", () => {
    const rule = livePreviewThemeSpec[".cm-crossref-citation.invalid"] as Record<string, string>;
    expect(rule.color).toContain("--crossref-invalid-color");
  });

  it(".cm-crossref-citeproc-key.invalid uses --crossref-invalid-color", () => {
    const rule = livePreviewThemeSpec[".cm-crossref-citeproc-key.invalid"] as Record<string, string>;
    expect(rule.color).toContain("--crossref-invalid-color");
  });

  it("@keyframes cm-crossref-blink uses --crossref-highlight-color", () => {
    const rule = livePreviewThemeSpec["@keyframes cm-crossref-blink"] as Record<string, Record<string, string>>;
    expect(rule["0%"]!.backgroundColor).toContain("--crossref-highlight-color");
  });

  it(".cm-crossref-citation:hover has underline", () => {
    const rule = livePreviewThemeSpec[".cm-crossref-citation:hover"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule.textDecoration).toBe("underline");
  });

  it(".cm-crossref-citeproc-key:hover has underline", () => {
    const rule = livePreviewThemeSpec[".cm-crossref-citeproc-key:hover"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule.textDecoration).toBe("underline");
  });

  it("citeproc color is distinct from citation color", () => {
    const citation = livePreviewThemeSpec[".cm-crossref-citation"] as Record<string, string>;
    const citeproc = livePreviewThemeSpec[".cm-crossref-citeproc"] as Record<string, string>;
    expect(citeproc.color).not.toBe(citation.color);
  });
});

describe("list item continuation theme spec", () => {
  it("defines .cm-list-item-continuation with paddingLeft", () => {
    const rule = livePreviewThemeSpec[".cm-list-item-continuation"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule.paddingLeft).toContain("--li-indent");
  });

  it("defines .cm-blockquote.cm-list-item-continuation with compound paddingLeft", () => {
    const rule = livePreviewThemeSpec[".cm-blockquote.cm-list-item-continuation"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule.paddingLeft).toContain("--li-indent");
    expect(rule.paddingLeft).toContain("8px");
  });

  it("defines .cm-callout.cm-list-item-continuation with compound paddingLeft", () => {
    const rule = livePreviewThemeSpec[".cm-callout.cm-list-item-continuation"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule.paddingLeft).toContain("--li-indent");
    expect(rule.paddingLeft).toContain("12px");
  });
});

describe("callout theme spec", () => {
  it(".cm-callout-header matches the annotation callout header (0.9em, weight 600)", () => {
    const rule = livePreviewThemeSpec[".cm-callout-header"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule.padding).toBe("0");
    expect(rule.fontSize).toBe("0.9em");
    expect(rule.fontWeight).toBe("600");
  });

  it(".cm-callout box mirrors .cm-annotation-callout (4px border, 12px inline padding, 5% background)", () => {
    const rule = livePreviewThemeSpec[".cm-callout"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule.borderInlineStart).toContain("4px solid");
    expect(rule.padding).toBe("0 12px");
    expect(rule.backgroundColor).toContain("5%");
    expect(rule.borderRadius).toBeUndefined();
  });

  it("edge lines carry the block's vertical padding and corner radii", () => {
    const first = livePreviewThemeSpec[".cm-callout-first"] as Record<string, string>;
    expect(first.paddingTop).toBe("8px");
    expect(first.borderStartStartRadius).toBe("4px");
    const last = livePreviewThemeSpec[".cm-callout-last"] as Record<string, string>;
    expect(last.paddingBottom).toBe("8px");
    expect(last.borderEndEndRadius).toBe("4px");
    // -last must be declared after -first so a collapsed header (both classes)
    // gets the 8px bottom edge padding.
    const keys = Object.keys(livePreviewThemeSpec);
    expect(keys.indexOf(".cm-callout-last")).toBeGreaterThan(keys.indexOf(".cm-callout-first"));
  });

  it(".cm-callout-icon matches the header font size", () => {
    const rule = livePreviewThemeSpec[".cm-callout-icon"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule.fontSize).toBe("1em");
  });

  it(".cm-callout-fold-icon .svg-icon is 16px", () => {
    const rule = livePreviewThemeSpec[".cm-callout-fold-icon .svg-icon"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule.width).toBe("16px");
    expect(rule.height).toBe("16px");
  });
});
