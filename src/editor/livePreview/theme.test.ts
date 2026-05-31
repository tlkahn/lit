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
});

describe("inline code theme spec", () => {
  it(".cm-preview-code-inline has no fontSize to avoid size changes on toggle", () => {
    const rule = livePreviewThemeSpec[".cm-preview-code-inline"] as Record<string, string>;
    expect(rule).toBeDefined();
    expect(rule).not.toHaveProperty("fontSize");
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
