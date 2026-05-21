import { describe, it, expect, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { FootnoteRefWidget } from "./footnoteWidgets";

vi.mock("katex", () => ({
  default: { render: vi.fn() },
}));
vi.mock("katex/dist/katex.min.css", () => ({}));

const mockView = {} as EditorView;

describe("FootnoteRefWidget", () => {
  it("toDOM returns sup with number and class", () => {
    const widget = new FootnoteRefWidget("1", 1, null);
    const el = widget.toDOM(mockView);
    expect(el.tagName).toBe("SUP");
    expect(el.className).toBe("cm-footnote-ref");
    expect(el.textContent).toBe("1");
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

    const widget = new FootnoteRefWidget("1", 1, 42);
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
    const widget = new FootnoteRefWidget("1", 1, null);
    const el = widget.toDOM(mockView);
    expect(el.onmousedown).toBeNull();
  });

  it("eq returns true for same label+number+targetDefPos", () => {
    const a = new FootnoteRefWidget("1", 1, 42);
    const b = new FootnoteRefWidget("1", 1, 42);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different number", () => {
    const a = new FootnoteRefWidget("1", 1, 42);
    const b = new FootnoteRefWidget("1", 2, 42);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false for different targetDefPos", () => {
    const a = new FootnoteRefWidget("1", 1, 42);
    const b = new FootnoteRefWidget("1", 1, 100);
    expect(a.eq(b)).toBe(false);
  });

  it("ignoreEvent returns true", () => {
    const widget = new FootnoteRefWidget("1", 1, null);
    expect(widget.ignoreEvent()).toBe(true);
  });

  it("has estimatedHeight of 16", () => {
    const widget = new FootnoteRefWidget("1", 1, null);
    expect(widget.estimatedHeight).toBe(16);
  });
});
