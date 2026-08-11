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

  it("renders display math with \\[...\\] delimiters", () => {
    const result = renderMarkdown("\\[x^2\\]");
    expect(result).toContain("cm-preview-math-display");
    expect(result).toContain("katex");
  });

  it("renders multi-line display math with \\[...\\] delimiters", () => {
    const result = renderMarkdown("\\[\nx^2\n\\]");
    expect(result).toContain("cm-preview-math-display");
  });

  it("renders inline math with \\(...\\) delimiters", () => {
    const result = renderMarkdown("The equation \\(x^2\\) is simple.");
    expect(result).toContain("cm-preview-math-inline");
    expect(result).toContain("katex");
  });

  it("keeps escaped \\\\(literal\\\\) as literal text", () => {
    const result = renderMarkdown("\\\\(literal\\\\)");
    expect(result).not.toContain("cm-preview-math");
  });

  it("preserves code spans containing \\[not math\\]", () => {
    const result = renderMarkdown("`\\[not math\\]`");
    expect(result).toContain("<code>");
    expect(result).not.toContain("cm-preview-math");
  });

  it("preserves fenced code blocks containing \\[", () => {
    const result = renderMarkdown("```\n\\[\nx\n\\]\n```");
    expect(result).toContain("<code>");
    expect(result).not.toContain("cm-preview-math");
  });

  it("\\[ $x$ \\] renders as one display block (pass order)", () => {
    const result = renderMarkdown("\\[ $x$ \\]");
    expect(result).toContain("cm-preview-math-display");
    expect(result).not.toContain("cm-preview-math-inline");
  });

  it("does not fuse unrelated \\[...\\] across paragraphs into display math", () => {
    const input = "The task \\[TODO\\]\n\nSome heading\n\nprices \\[USD\\]";
    const result = renderMarkdown(input);
    // Both \[ are mid-line so neither should become display math.
    // The old regex fused the first \[ with the last \], swallowing
    // all intervening prose into a single KaTeX block.
    expect(result).not.toContain("cm-preview-math-display");
    expect(result).toContain("Some heading");
  });

  it("does not render \\[...\\] as display math when \\[ is mid-line", () => {
    const input = "See \\[1\\] for details";
    const result = renderMarkdown(input);
    expect(result).not.toContain("cm-preview-math-display");
    expect(result).toContain("details");
  });

  it("does not render display math when opener line has content after \\[", () => {
    const input = "\\[ some content\nmore\n\\]";
    const result = renderMarkdown(input);
    expect(result).not.toContain("cm-preview-math-display");
  });

  it("does not render display math when there is trailing text after \\]", () => {
    const input = "\\[E=mc^2\\] and some text";
    const result = renderMarkdown(input);
    expect(result).not.toContain("cm-preview-math-display");
  });

  it("does not render \\[a\\] text \\[b\\] as display math (first \\] has trailing prose)", () => {
    const input = "\\[a\\] text \\[b\\]";
    const result = renderMarkdown(input);
    expect(result).not.toContain("cm-preview-math-display");
  });

  it("renders \\[a\\] as display math (single-char content, empty tail after first \\])", () => {
    const input = "\\[a\\]";
    const result = renderMarkdown(input);
    expect(result).toContain("cm-preview-math-display");
  });

  it("renders \\[E=mc^2\\] {#eq:energy} as display math (label after first \\])", () => {
    const input = "\\[E=mc^2\\] {#eq:energy}";
    const result = renderMarkdown(input);
    expect(result).toContain("cm-preview-math-display");
  });

  it("does not render \\[\\] as display math (empty content fails closeIdx > 2 guard)", () => {
    const input = "\\[\\]";
    const result = renderMarkdown(input);
    expect(result).not.toContain("cm-preview-math-display");
  });

  it("does not render \\[a\\] {#eq:test} extra as display math (afterClose is not purely a label)", () => {
    const input = "\\[a\\] {#eq:test} extra";
    const result = renderMarkdown(input);
    expect(result).not.toContain("cm-preview-math-display");
  });

  it("renders $$E=mc^2$$ {#eq:energy} as display math and strips label", () => {
    const result = renderMarkdown("$$E=mc^2$$ {#eq:energy}");
    expect(result).toContain("cm-preview-math-display");
    expect(result).not.toContain("{#eq:");
  });

  it("renders multi-line $$...$$  with label and strips label", () => {
    const result = renderMarkdown("$$\nE=mc^2\n$$ {#eq:energy}");
    expect(result).toContain("cm-preview-math-display");
    expect(result).not.toContain("{#eq:");
  });

  it("renders multi-line \\[...\\] with label and strips label", () => {
    const result = renderMarkdown("\\[\nE=mc^2\n\\] {#eq:energy}");
    expect(result).toContain("cm-preview-math-display");
    expect(result).not.toContain("{#eq:");
  });

  it("renders $$E=mc^2$${#eq:a} (no space before label) as display math and strips label", () => {
    const result = renderMarkdown("$$E=mc^2$${#eq:a}");
    expect(result).toContain("cm-preview-math-display");
    expect(result).not.toContain("{#eq:");
  });

  it("does not swallow text after a label on $$ display math", () => {
    const result = renderMarkdown("$$E=mc^2$$ {#eq:a} extra text");
    // The label is consumed but "extra text" remains as prose
    expect(result).toContain("extra text");
  });

  // Tradeoff: \( is math, not CommonMark escape — this is intentional.
  // Same precedence as Pandoc, MathJax, KaTeX auto-render, Obsidian, Typora.
  // Users who want literal backslash+paren use \\(.
  it("f\\(x\\) is undefined here renders \\(x\\) as inline math (tradeoff)", () => {
    const result = renderMarkdown("f\\(x\\) is undefined here");
    expect(result).toContain("cm-preview-math-inline");
    expect(result).toContain("katex");
  });

  it("mismatched \\(x$ is not math", () => {
    const result = renderMarkdown("\\(x$");
    expect(result).not.toContain("cm-preview-math");
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

  describe("escaped dollar → fullwidth glyph", () => {
    it("renders \\$ as the fullwidth glyph wrapped in a span", () => {
      const result = renderMarkdown("The price is \\$5.");
      expect(result).toContain("\uFF04");
      expect(result).toContain('class="md-escaped-dollar"');
      expect(result).not.toContain("cm-preview-math");
    });

    it("does not leave a visible \\$ pair for the escape", () => {
      const result = renderMarkdown("The price is \\$5.");
      const div = document.createElement("div");
      div.innerHTML = result;
      expect(div.textContent).toContain("\uFF04");
      expect(div.textContent).not.toContain("\\$");
    });

    it("renders multiple escaped dollars", () => {
      const result = renderMarkdown("\\$a and \\$b");
      expect(result.split("\uFF04")).toHaveLength(3);
    });

    it("3-backslash escaped dollar keeps the backslash and glyph", () => {
      const result = renderMarkdown(String.raw`\\\$5`);
      const div = document.createElement("div");
      div.innerHTML = result;
      // marked collapses the escaped backslash to a single backslash
      expect(div.textContent).toContain("\\");
      expect(div.textContent).toContain("\uFF04");
      expect(div.textContent).not.toContain("\\$");
    });

    it("2-backslash + bare dollar does not become a lone fullwidth glyph", () => {
      const result = renderMarkdown(String.raw`\\$`);
      const div = document.createElement("div");
      div.innerHTML = result;
      expect(div.textContent).toContain("\\$");
      expect(div.textContent).not.toContain("\uFF04");
    });

    it("keeps math delimiters working ($E=mc^2$ is still math)", () => {
      const result = renderMarkdown("$E=mc^2$ and \\$5");
      expect(result).toContain("cm-preview-math-inline");
      expect(result).toContain("\uFF04");
    });

    it("preserves \\$ inside inline code spans", () => {
      const result = renderMarkdown("`\\$` code");
      expect(result).toContain("<code>\\$</code>");
      expect(result).not.toContain("\uFF04");
    });

    it("preserves \\$ inside fenced code blocks", () => {
      const result = renderMarkdown("```\n\\$5\n```");
      expect(result).toContain("<code>");
      expect(result).toContain("\\$");
      expect(result).not.toContain("\uFF04");
    });
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

  it("preserves double-backtick code spans with internal single backtick", () => {
    const result = renderMarkdown("``$x` and more``");
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

describe("renderMarkdown footnotes", () => {
  it("renders a numbered ref and a footnotes section with backref", () => {
    const result = renderMarkdown("Hello[^1] world\n\n[^1]: the note");
    const div = document.createElement("div");
    div.innerHTML = result;
    const ref = div.querySelector("sup a[data-footnote-ref]");
    expect(ref).not.toBeNull();
    expect(ref!.textContent).toBe("1");
    expect(ref!.getAttribute("href")).toMatch(/^#fn-\d+-1$/);
    const section = div.querySelector("section.footnotes");
    expect(section).not.toBeNull();
    const li = section!.querySelector("li");
    expect(li!.textContent).toContain("the note");
    expect(section!.querySelector("a[data-footnote-backref]")).not.toBeNull();
  });

  it("numbers tagged refs and renders markdown in definition bodies", () => {
    const result = renderMarkdown("text[^svayoginivaha]\n\n[^svayoginivaha]: **bold** note");
    const div = document.createElement("div");
    div.innerHTML = result;
    const ref = div.querySelector("sup a[data-footnote-ref]");
    expect(ref!.textContent).toBe("1");
    const li = div.querySelector("section.footnotes li");
    expect(li!.innerHTML).toContain("<strong>bold</strong>");
  });

  it("keeps a ref without a definition as literal text", () => {
    const result = renderMarkdown("Hello[^1] world");
    expect(result).toContain("[^1]");
    expect(result).not.toContain("data-footnote-ref");
  });

  it("consumes orphan definitions without output", () => {
    const result = renderMarkdown("Hello world\n\n[^1]: orphan note");
    expect(result).not.toContain("footnotes");
    expect(result).not.toContain("orphan note");
    expect(result).not.toContain("[^1]");
  });

  it("uses a distinct id prefix per render (no id collisions)", () => {
    const input = "Hello[^1]\n\n[^1]: note";
    const first = renderMarkdown(input);
    const second = renderMarkdown(input);
    const idOf = (html: string) => /id="(fn-\d+-)ref-1"/.exec(html)?.[1];
    expect(idOf(first)).toBeDefined();
    expect(idOf(second)).toBeDefined();
    expect(idOf(first)).not.toBe(idOf(second));
  });

  it("leaves refs inside inline code untouched", () => {
    const result = renderMarkdown("`[^1]` code\n\n[^1]: note");
    expect(result).toContain("<code>[^1]</code>");
    expect(result).not.toContain("data-footnote-ref");
  });

  it("strips script tags in definition bodies", () => {
    const result = renderMarkdown("x[^1]\n\n[^1]: <script>alert(1)</script>safe");
    expect(result).not.toContain("<script>");
    expect(result).toContain("safe");
  });

  it("does not change output for bodies without footnotes", () => {
    const result = renderMarkdown("**bold** text");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).not.toContain("footnote");
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

  it("replaces footnote refs with non-anchor sup markers", () => {
    const result = renderInlineMarkdown("see[^alpha] and[^beta] then[^alpha] again");
    const div = document.createElement("div");
    div.innerHTML = result;
    const sups = div.querySelectorAll("sup.footnote-ref");
    expect(sups).toHaveLength(3);
    expect(Array.from(sups).map((s) => s.textContent)).toEqual(["1", "2", "1"]);
    expect(div.querySelector("a")).toBeNull();
  });

  it("strips footnote definition lines including continuations", () => {
    const result = renderInlineMarkdown(
      "note[^1] here\n[^1]: hidden def\n    continuation line\nvisible tail",
    );
    expect(result).toContain('<sup class="footnote-ref">1</sup>');
    expect(result).not.toContain("hidden def");
    expect(result).not.toContain("continuation line");
    expect(result).toContain("visible tail");
  });

  it("leaves refs inside inline code untouched", () => {
    const result = renderInlineMarkdown("`[^1]` code");
    expect(result).toContain("<code>[^1]</code>");
    expect(result).not.toContain("footnote-ref");
  });
});

describe("renderMarkdown hr variants", () => {
  it("renders --- as short hr", () => {
    const result = renderMarkdown("---");
    expect(result).toContain('class="md-hr md-hr-short"');
  });

  it("renders ---- as full hr", () => {
    const result = renderMarkdown("----");
    expect(result).toContain('class="md-hr"');
    expect(result).not.toContain("md-hr-short");
  });

  it("renders *** as full hr", () => {
    const result = renderMarkdown("***");
    expect(result).toContain('class="md-hr"');
    expect(result).not.toContain("md-hr-short");
  });

  it("renders ***** as full hr", () => {
    const result = renderMarkdown("*****");
    expect(result).toContain('class="md-hr"');
    expect(result).not.toContain("md-hr-short");
  });

  it("renders ___ as full hr", () => {
    const result = renderMarkdown("___");
    expect(result).toContain('class="md-hr"');
    expect(result).not.toContain("md-hr-short");
  });

  it("renders spaced dashes - - - as short hr", () => {
    const result = renderMarkdown("- - -");
    expect(result).toContain("md-hr-short");
  });

  it("renders setext heading (text\\n---) as h2, not hr", () => {
    const result = renderMarkdown("heading\n---");
    expect(result).toContain("<h2");
    expect(result).not.toContain("md-hr");
  });

  it("class attribute survives DOMPurify sanitization", () => {
    const result = renderMarkdown("---");
    const div = document.createElement("div");
    div.innerHTML = result;
    const hr = div.querySelector("hr");
    expect(hr?.classList.contains("md-hr")).toBe(true);
    expect(hr?.classList.contains("md-hr-short")).toBe(true);
  });
});
