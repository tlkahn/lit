import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { HighlightedText } from "./HighlightedText";

describe("HighlightedText", () => {
  it("renders plain text when indices is empty", () => {
    const { container } = render(<HighlightedText text="Hello world" indices={[]} />);
    expect(container.textContent).toBe("Hello world");
    expect(container.querySelectorAll("mark")).toHaveLength(0);
  });

  it("wraps matched grapheme indices in <mark> elements", () => {
    const { container } = render(<HighlightedText text="Hello" indices={[0]} />);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe("H");
  });

  it("consecutive matched indices produce a single <mark> span", () => {
    const { container } = render(<HighlightedText text="Hello" indices={[0, 1, 2]} />);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe("Hel");
  });

  it("non-consecutive matched indices produce separate <mark> spans", () => {
    const { container } = render(<HighlightedText text="Hello" indices={[0, 3]} />);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(2);
    expect(marks[0]!.textContent).toBe("H");
    expect(marks[1]!.textContent).toBe("l");
  });
});
