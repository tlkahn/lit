import { describe, it, expect, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { FootnoteRefWidget, FootnoteDefMarkWidget, FootnoteDefBodyWidget } from "./footnoteWidgets";
import { getKatexSync, loadKatex } from "./katexLoader";

const mockKatex = {
  render: vi.fn(),
  renderToString: vi.fn((tex: string) => `<span class="katex">${tex}</span>`),
};

vi.mock("./katexLoader", () => ({
  getKatexSync: vi.fn(() => mockKatex),
  loadKatex: vi.fn(async () => mockKatex),
  resetKatexLoader: vi.fn(),
}));
vi.mock("katex/dist/katex.min.css", () => ({}));

const mockView = {} as EditorView;

describe("FootnoteRefWidget", () => {
  it("toDOM returns sup showing the source label", () => {
    const widget = new FootnoteRefWidget("3", null);
    const el = widget.toDOM(mockView);
    expect(el.tagName).toBe("SUP");
    expect(el.className).toBe("cm-footnote-ref");
    expect(el.textContent).toBe("3");
  });

  it("toDOM shows a named label as-is", () => {
    const widget = new FootnoteRefWidget("note", null);
    const el = widget.toDOM(mockView);
    expect(el.textContent).toBe("note");
  });

  it("click handler dispatches selection to targetDefPos", () => {
    const dispatch = vi.fn();
    const focus = vi.fn();
    const posAtCoords = vi.fn().mockReturnValue(10);
    const mockState = {
      doc: { lineAt: () => ({ number: 1, from: 0 }) },
    };
    const domAtPos = vi.fn().mockReturnValue({ node: { parentElement: null } });
    const view = { dispatch, focus, posAtCoords, domAtPos, state: mockState } as unknown as EditorView;

    const widget = new FootnoteRefWidget("1", 42);
    const el = widget.toDOM(view);

    const event = new MouseEvent("mousedown", { clientX: 100, clientY: 200 });
    el.onmousedown!(event);

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: 42 },
        scrollIntoView: true,
      }),
    );
  });

  it("no dispatch when targetDefPos is null", () => {
    const widget = new FootnoteRefWidget("1", null);
    const el = widget.toDOM(mockView);
    expect(el.onmousedown).toBeNull();
  });

  it("eq returns true for same label and targetDefPos", () => {
    const a = new FootnoteRefWidget("1", 42);
    const b = new FootnoteRefWidget("1", 42);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different label", () => {
    const a = new FootnoteRefWidget("1", 42);
    const b = new FootnoteRefWidget("2", 42);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false for different targetDefPos", () => {
    const a = new FootnoteRefWidget("1", 42);
    const b = new FootnoteRefWidget("1", 100);
    expect(a.eq(b)).toBe(false);
  });

  it("ignoreEvent returns true", () => {
    const widget = new FootnoteRefWidget("1", null);
    expect(widget.ignoreEvent()).toBe(true);
  });

  it("has estimatedHeight of 16", () => {
    const widget = new FootnoteRefWidget("1", null);
    expect(widget.estimatedHeight).toBe(16);
  });
});

describe("FootnoteDefMarkWidget", () => {
  it("toDOM returns span with class and label + dot", () => {
    const widget = new FootnoteDefMarkWidget("3");
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("cm-footnote-def-mark");
    expect(el.textContent).toBe("3.");
  });

  it("toDOM shows a named label with dot", () => {
    const widget = new FootnoteDefMarkWidget("note");
    const el = widget.toDOM();
    expect(el.textContent).toBe("note.");
  });

  it("eq returns true for same label", () => {
    const a = new FootnoteDefMarkWidget("2");
    const b = new FootnoteDefMarkWidget("2");
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different label", () => {
    const a = new FootnoteDefMarkWidget("2");
    const b = new FootnoteDefMarkWidget("5");
    expect(a.eq(b)).toBe(false);
  });

  it("ignoreEvent returns false (do not swallow caret placement clicks)", () => {
    const widget = new FootnoteDefMarkWidget("1");
    expect(widget.ignoreEvent()).toBe(false);
  });

  it("has estimatedHeight of 16", () => {
    const widget = new FootnoteDefMarkWidget("1");
    expect(widget.estimatedHeight).toBe(16);
  });
});

describe("FootnoteDefBodyWidget", () => {
  it("toDOM returns a div with class cm-footnote-def-body", () => {
    const widget = new FootnoteDefBodyWidget("Definition text");
    const el = widget.toDOM();
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("cm-footnote-def-body");
  });

  it("toDOM renders bold markdown via renderFootnoteBody", () => {
    const widget = new FootnoteDefBodyWidget("**bold** and *em*");
    const el = widget.toDOM();
    expect(el.innerHTML).toContain("<strong>bold</strong>");
    expect(el.innerHTML).toContain("<em>em</em>");
  });

  it("toDOM renders inline math (placeholder path when katex not loaded)", () => {
    vi.mocked(getKatexSync).mockReturnValueOnce(null);
    const widget = new FootnoteDefBodyWidget("sigma $x$");
    const el = widget.toDOM();
    // katex is not loaded, so renderMathToHtml emits the placeholder span
    // with the latex text visible (element is detached, so no upgrade).
    expect(el.innerHTML).toContain("cm-preview-math-placeholder");
    expect(el.innerHTML).toContain("x");
  });

  it("toDOM shows math placeholder then upgrades after loadKatex when katex was not ready", async () => {
    vi.mocked(getKatexSync).mockReturnValueOnce(null);

    const widget = new FootnoteDefBodyWidget("sigma $x$");
    const el = widget.toDOM();
    document.body.appendChild(el); // must be connected for the upgrade
    expect(el.innerHTML).toContain("cm-preview-math-placeholder");

    await vi.waitFor(() => {
      expect(el.innerHTML).not.toContain("cm-preview-math-placeholder");
    });
    expect(el.innerHTML).toMatch(/katex|cm-preview-math-inline/);
    el.remove();
  });

  it("toDOM does not call loadKatex when katex is already sync-available", () => {
    // The factory default getKatexSync -> mockKatex renders math inline
    // immediately, so no async upgrade is needed.
    vi.mocked(loadKatex).mockClear();
    const widget = new FootnoteDefBodyWidget("sigma $x$");
    const el = widget.toDOM();
    expect(el.innerHTML).not.toContain("cm-preview-math-placeholder");
    expect(el.innerHTML).toContain("cm-preview-math-inline");
    expect(loadKatex).not.toHaveBeenCalled();
  });

  it("toDOM does not throw if loadKatex resolves after the node is detached", async () => {
    vi.mocked(getKatexSync).mockReturnValueOnce(null);

    const el = new FootnoteDefBodyWidget("$x$").toDOM();
    // Deliberately never attached: the upgrade must bail without throwing.
    await Promise.resolve();
    await Promise.resolve();
    expect(el.innerHTML).toContain("cm-preview-math-placeholder");
  });

  it("toDOM sanitizes script tags out of the body", () => {
    const widget = new FootnoteDefBodyWidget("<script>alert('xss')</script>");
    const el = widget.toDOM();
    expect(el.innerHTML).not.toContain("<script>");
  });

  it("toDOM renders block markdown (heading) inside the body", () => {
    const widget = new FootnoteDefBodyWidget("### Setup\ncontent");
    const el = widget.toDOM();
    expect(el.innerHTML).toContain("<h3>");
    expect(el.innerHTML).toContain("Setup");
  });

  it("toDOM renders display math inside a multi-line body", () => {
    const widget = new FootnoteDefBodyWidget("Before\n$$\nx^2\n$$\nAfter");
    const el = widget.toDOM();
    expect(el.innerHTML).toContain("cm-preview-math-display");
  });

  it("toDOM renders a multi-construct body (issue example excerpt)", () => {
    const widget = new FootnoteDefBodyWidget(
      "**bold** and *em* with $\\sigma$\n### Setup\n$$\nE = mc^2\n$$",
    );
    const el = widget.toDOM();
    expect(el.innerHTML).toContain("<strong>bold</strong>");
    expect(el.innerHTML).toContain("<em>em</em>");
    expect(el.innerHTML).toContain("<h3>");
    expect(el.innerHTML).toContain("cm-preview-math-inline");
    expect(el.innerHTML).toContain("cm-preview-math-display");
  });

  it("eq returns true for same bodyText and false for different", () => {
    const a = new FootnoteDefBodyWidget("same");
    const b = new FootnoteDefBodyWidget("same");
    const c = new FootnoteDefBodyWidget("different");
    expect(a.eq(b)).toBe(true);
    expect(a.eq(c)).toBe(false);
  });

  it("ignoreEvent returns false (clicks place caret into the def)", () => {
    const widget = new FootnoteDefBodyWidget("text");
    expect(widget.ignoreEvent()).toBe(false);
  });

  it("estimatedHeight is a finite number >= 16 and grows with more lines", () => {
    const single = new FootnoteDefBodyWidget("one line");
    const multi = new FootnoteDefBodyWidget("one\ntwo\nthree");
    expect(Number.isFinite(single.estimatedHeight)).toBe(true);
    expect(single.estimatedHeight).toBeGreaterThanOrEqual(16);
    expect(multi.estimatedHeight).toBeGreaterThan(single.estimatedHeight);
  });

  it("estimatedHeight adds extra for display-math fences", () => {
    const plain = new FootnoteDefBodyWidget("a\nb");
    const display = new FootnoteDefBodyWidget("$$\na\nb\n$$");
    expect(display.estimatedHeight).toBeGreaterThan(plain.estimatedHeight);
  });

  it("mousedown on a link inside the body prevents default navigation", () => {
    const el = new FootnoteDefBodyWidget("[go](https://example.com)").toDOM();
    const anchor = el.querySelector("a[href]") as HTMLAnchorElement;
    expect(anchor).toBeTruthy();
    const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
  });

  it("mousedown on non-link body text does not preventDefault", () => {
    const el = new FootnoteDefBodyWidget("plain text").toDOM();
    const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    el.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
  });
});
