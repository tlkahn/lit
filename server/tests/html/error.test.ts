import { describe, it, expect } from "vitest";
import { errorPageHtml } from "../../src/html/error.js";

describe("errorPageHtml", () => {
  it("contains a user-friendly error message", () => {
    const html = errorPageHtml();
    expect(html.toLowerCase()).toContain("something went wrong");
  });

  it("has proper HTML document structure", () => {
    const html = errorPageHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Error — Lit</title>");
  });
});
