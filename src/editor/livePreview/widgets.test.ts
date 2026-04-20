import { describe, it, expect } from "vitest";
import { ImageWidget } from "./widgets";

describe("ImageWidget", () => {
  it("toDOM returns an img element with correct src and alt", () => {
    const widget = new ImageWidget("photo.png", "A photo");
    const el = widget.toDOM();
    expect(el.tagName).toBe("IMG");
    expect(el.getAttribute("src")).toBe("photo.png");
    expect(el.getAttribute("alt")).toBe("A photo");
  });

  it("applies correct styles", () => {
    const widget = new ImageWidget("img.jpg", "");
    const el = widget.toDOM();
    expect(el.style.maxWidth).toBe("100%");
    expect(el.style.maxHeight).toBe("300px");
    expect(el.style.display).toBe("block");
  });

  it("eq returns true for same src and alt", () => {
    const a = new ImageWidget("a.png", "alt");
    const b = new ImageWidget("a.png", "alt");
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different src", () => {
    const a = new ImageWidget("a.png", "alt");
    const b = new ImageWidget("b.png", "alt");
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false for different alt", () => {
    const a = new ImageWidget("a.png", "one");
    const b = new ImageWidget("a.png", "two");
    expect(a.eq(b)).toBe(false);
  });

  it("ignoreEvent returns true", () => {
    const widget = new ImageWidget("x.png", "x");
    expect(widget.ignoreEvent()).toBe(true);
  });
});
