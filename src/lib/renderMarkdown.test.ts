import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./renderMarkdown";

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
});
