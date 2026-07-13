import { describe, it, expect } from "vitest";
import katex from "katex";
import { LATEX_COMPAT_MACROS, katexOptions } from "./latexCompat";

// Real katex (not the mock used elsewhere) so the table is validated
// against the installed KaTeX version: an entry whose replacement KaTeX
// can't parse, or a key KaTeX now supports natively but our snippet
// misuses, fails here rather than silently in the editor.
function renderStrict(tex: string): string {
  return katex.renderToString(tex, {
    throwOnError: true,
    macros: { ...LATEX_COMPAT_MACROS },
  });
}

// A representative use of each macro in the table.
function snippetFor(cmd: string): string {
  switch (cmd) {
    case "\\eqalign":
      return "\\eqalign{a &= b \\cr c &= d}";
    case "\\pmatrix":
      return "\\pmatrix{a & b \\cr c & d}";
    case "\\undertext":
      return "\\undertext{x}";
    case "\\vbox":
      return "\\vbox{x}";
    default:
      return `{${cmd} x}`;
  }
}

describe("LATEX_COMPAT_MACROS", () => {
  it.each(Object.keys(LATEX_COMPAT_MACROS))(
    "renders %s with throwOnError:true",
    (cmd) => {
      expect(() => renderStrict(snippetFor(cmd))).not.toThrow();
    },
  );

  it("renders the issue's trigger expression (ref63.md line 124)", () => {
    const tex = "\\int_{\\tenrm Reg~{}Cone}d^{2}x\\sqrt{g}R\\sim 4\\pi(1-n)";
    expect(() => renderStrict(tex)).not.toThrow();
  });

  it("does not shadow the \\begin{pmatrix} environment", () => {
    const tex = "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}";
    expect(() => renderStrict(tex)).not.toThrow();
    expect(renderStrict(tex)).toContain("katex");
  });

  it("supports \\eqalign with \\\\ row separators too", () => {
    expect(() => renderStrict("\\eqalign{a &= b \\\\ c &= d}")).not.toThrow();
  });
});

describe("katexOptions", () => {
  it("sets throwOnError:false and passes displayMode through", () => {
    expect(katexOptions(false)).toMatchObject({
      throwOnError: false,
      displayMode: false,
    });
    expect(katexOptions(true)).toMatchObject({
      throwOnError: false,
      displayMode: true,
    });
  });

  it("includes the compat table in macros", () => {
    expect(katexOptions(false).macros).toEqual(LATEX_COMPAT_MACROS);
  });

  it("returns a fresh macros object each call", () => {
    const a = katexOptions(false);
    const b = katexOptions(false);
    expect(a.macros).not.toBe(b.macros);
  });

  it("mutating a returned macros object does not affect the table or later calls", () => {
    const opts = katexOptions(false);
    (opts.macros as Record<string, string>)["\\userdef"] = "\\alpha";
    expect(LATEX_COMPAT_MACROS).not.toHaveProperty("\\userdef");
    expect(katexOptions(false).macros).not.toHaveProperty("\\userdef");
  });
});
