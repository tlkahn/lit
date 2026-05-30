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
});
