import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderMathToHtml, replaceInlineMath } from "./renderMath";
import { getKatexSync } from "../editor/livePreview/katexLoader";

const mockKatex = {
  render: vi.fn(),
  renderToString: vi.fn((tex: string) => `<span class="katex">${tex}</span>`),
};

vi.mock("../editor/livePreview/katexLoader", () => ({
  getKatexSync: vi.fn(() => mockKatex),
  loadKatex: vi.fn(async () => mockKatex),
  resetKatexLoader: vi.fn(),
}));

vi.mock("katex/dist/katex.min.css", () => ({}));

describe("renderMathToHtml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKatex.renderToString.mockImplementation(
      (tex: string) => `<span class="katex">${tex}</span>`,
    );
  });

  it("renders inline math with KaTeX", () => {
    const result = renderMathToHtml("E=mc^2", false);
    expect(result).toContain('<span class="cm-preview-math-inline">');
    expect(result).toContain('<span class="katex">');
    expect(result).toContain("E=mc^2");
  });

  it("renders display math with KaTeX", () => {
    const result = renderMathToHtml("\\int x", true);
    expect(result).toContain('<div class="cm-preview-math-display">');
    expect(result).toContain("katex");
  });

  it("passes displayMode:false to renderToString for inline math", () => {
    renderMathToHtml("x", false);
    expect(mockKatex.renderToString).toHaveBeenCalledWith(
      "x",
      expect.objectContaining({ throwOnError: false, displayMode: false }),
    );
  });

  it("passes displayMode:true to renderToString for display math", () => {
    renderMathToHtml("x", true);
    expect(mockKatex.renderToString).toHaveBeenCalledWith(
      "x",
      expect.objectContaining({ throwOnError: false, displayMode: true }),
    );
  });

  it("passes compat macros to renderToString", () => {
    renderMathToHtml("x", false);
    expect(mockKatex.renderToString).toHaveBeenCalledWith(
      "x",
      expect.objectContaining({
        macros: expect.objectContaining({ "\\tenrm": "\\rm" }),
      }),
    );
  });

  it("shows error class on KaTeX throw", () => {
    mockKatex.renderToString.mockImplementationOnce(() => {
      throw new Error("parse error");
    });
    const result = renderMathToHtml("bad", false);
    expect(result).toContain("cm-preview-math-error");
    expect(result).toContain("bad");
  });

  it("shows placeholder when KaTeX not loaded", () => {
    vi.mocked(getKatexSync).mockReturnValueOnce(null);
    const result = renderMathToHtml("E=mc^2", false);
    expect(result).toContain("cm-preview-math-placeholder");
    expect(result).toContain("E=mc^2");
    expect(result).not.toContain("katex");
  });

  it("escapes HTML in placeholder when KaTeX not loaded", () => {
    vi.mocked(getKatexSync).mockReturnValueOnce(null);
    const result = renderMathToHtml("<script>", false);
    expect(result).toContain("&lt;script&gt;");
    expect(result).not.toContain("<script>");
  });

  it("escapes HTML in error output", () => {
    mockKatex.renderToString.mockImplementationOnce(() => {
      throw new Error("parse error");
    });
    const result = renderMathToHtml("<script>", false);
    expect(result).toContain("&lt;script&gt;");
    expect(result).not.toContain("<script>");
  });

  it("uses span tag for inline mode", () => {
    const result = renderMathToHtml("x", false);
    expect(result).toMatch(/^<span /);
    expect(result).toMatch(/<\/span>$/);
  });

  it("uses div tag for display mode", () => {
    const result = renderMathToHtml("x", true);
    expect(result).toMatch(/^<div /);
    expect(result).toMatch(/<\/div>$/);
  });

  it("sanitizes KaTeX output to prevent XSS", () => {
    mockKatex.renderToString.mockReturnValueOnce(
      '<span class="katex"><img src=x onerror=alert(1)></span>',
    );
    const result = renderMathToHtml("x", false);
    expect(result).not.toContain("onerror");
  });
});

describe("replaceInlineMath", () => {
  it("replaces $...$ math and calls replacer with latex content", () => {
    const result = replaceInlineMath("hello $x^2$ world", (latex) => `[${latex}]`);
    expect(result).toBe("hello [x^2] world");
  });

  it("replaces \\(...\\) math and calls replacer with latex content", () => {
    const result = replaceInlineMath("hello \\(x^2\\) world", (latex) => `[${latex}]`);
    expect(result).toBe("hello [x^2] world");
  });

  it("replaces both $...$ and \\(...\\) in one string", () => {
    const result = replaceInlineMath("$a$ and \\(b\\)", (latex) => `[${latex}]`);
    expect(result).toBe("[a] and [b]");
  });

  it("does not match escaped dollar \\$x\\$", () => {
    const result = replaceInlineMath("\\$x\\$", (latex) => `[${latex}]`);
    expect(result).toBe("\\$x\\$");
  });

  it("does not match escaped backslash-paren \\\\(not math\\)", () => {
    const result = replaceInlineMath("\\\\(not math\\)", (latex) => `[${latex}]`);
    expect(result).toBe("\\\\(not math\\)");
  });

  it("does not match spaced dollars $ x $", () => {
    const result = replaceInlineMath("$ x $", (latex) => `[${latex}]`);
    expect(result).toBe("$ x $");
  });
});
