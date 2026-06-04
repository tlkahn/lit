import { describe, it, expect, vi } from "vitest";
import { renderMarkdown, renderInlineMarkdown } from "./renderMarkdown";
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

describe("renderMarkdown", () => {
  it("renders markdown to sanitized HTML", () => {
    const result = renderMarkdown("**bold**");
    expect(result).toContain("<strong>bold</strong>");
  });

  it("strips script tags", () => {
    const result = renderMarkdown('<script>alert("xss")</script>Safe');
    expect(result).not.toContain("<script>");
    expect(result).toContain("Safe");
  });

  it("returns empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("adds target=_blank and rel=noopener noreferrer to links", () => {
    const result = renderMarkdown("[example](https://example.com)");
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it("target attribute survives DOMPurify sanitization", () => {
    const result = renderMarkdown("[link](https://example.com)");
    const div = document.createElement("div");
    div.innerHTML = result;
    const anchor = div.querySelector("a");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toContain("noopener");
  });

  it("renders inline math with KaTeX", () => {
    const result = renderMarkdown("The equation $E=mc^2$ is famous.");
    expect(result).toContain("cm-preview-math-inline");
    expect(result).toContain("katex");
    expect(result).toContain("E=mc^2");
  });

  it("renders display math with KaTeX", () => {
    const result = renderMarkdown("$$\\int_0^1 x^2 dx$$");
    expect(result).toContain("cm-preview-math-display");
    expect(result).toContain("katex");
  });

  it("shows placeholder when KaTeX is not loaded", () => {
    vi.mocked(getKatexSync).mockReturnValueOnce(null);
    const result = renderMarkdown("$E=mc^2$");
    expect(result).toContain("cm-preview-math-placeholder");
    expect(result).toContain("E=mc^2");
    expect(result).not.toContain("katex");
  });

  it("does not treat LaTeX underscores as italic", () => {
    const result = renderMarkdown("$a_i + b_j$");
    expect(result).not.toContain("<em>");
    expect(result).toContain("cm-preview-math-inline");
  });

  it("renders mixed markdown and math", () => {
    const result = renderMarkdown("**bold** and $x^2$");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("cm-preview-math-inline");
  });

  it("preserves code blocks containing dollar signs", () => {
    const result = renderMarkdown("`$notmath$`");
    expect(result).toContain("<code>");
    expect(result).not.toContain("cm-preview-math");
  });

  it("renders display math containing dollar signs", () => {
    const result = renderMarkdown("$$\\text{costs \\$5}$$");
    expect(result).toContain("cm-preview-math-display");
  });

  it("preserves tilde-fenced code blocks containing dollar signs", () => {
    const result = renderMarkdown("~~~\n$notmath$\n~~~");
    expect(result).toContain("<code>");
    expect(result).not.toContain("cm-preview-math");
  });

  it("preserves double-backtick code spans containing dollar signs", () => {
    const result = renderMarkdown("``$notmath$``");
    expect(result).toContain("<code>");
    expect(result).not.toContain("cm-preview-math");
  });

  it("preserves style attributes in KaTeX output after sanitization", () => {
    mockKatex.renderToString.mockReturnValueOnce(
      '<span class="katex" style="color:red;">E=mc^2</span>',
    );
    const result = renderMarkdown("$E=mc^2$");
    expect(result).toContain("style=");
  });

  it("preserves MathML elements including semantics and annotation in KaTeX output", () => {
    mockKatex.renderToString.mockReturnValueOnce(
      '<span class="katex"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math></span>',
    );
    const result = renderMarkdown("$x$");
    expect(result).toContain("<math>");
    expect(result).toContain("<mi>");
    expect(result).toContain("<semantics>");
    expect(result).toContain("<annotation");
  });

  it("strips script tags injected into KaTeX output", () => {
    mockKatex.renderToString.mockReturnValueOnce(
      '<span class="katex"><script>alert(1)</script>safe</span>',
    );
    const result = renderMarkdown("$x$");
    expect(result).not.toContain("<script>");
    expect(result).toContain("safe");
  });
});

describe("renderInlineMarkdown", () => {
  it("renders inline math", () => {
    const result = renderInlineMarkdown("$E=mc^2$");
    expect(result).toContain("cm-preview-math-inline");
    expect(result).toContain("katex");
  });

  it("renders mixed inline markdown and math", () => {
    const result = renderInlineMarkdown("**bold** and $x^2$");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("cm-preview-math-inline");
  });

  it("returns empty string for empty input", () => {
    expect(renderInlineMarkdown("")).toBe("");
  });
});
