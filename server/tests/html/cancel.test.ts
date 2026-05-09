import { describe, it, expect } from "vitest";
import { cancelPageHtml } from "../../src/html/cancel.js";

describe("cancelPageHtml", () => {
  it("contains cancel message", () => {
    const html = cancelPageHtml();
    expect(html.toLowerCase()).toContain("cancel");
  });

  it("contains a link to lit.solar", () => {
    const html = cancelPageHtml();
    expect(html).toContain('href="https://lit.solar"');
    expect(html).toContain("lit.solar");
  });

  it("has proper HTML document structure", () => {
    const html = cancelPageHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Purchase Cancelled — Lit</title>");
  });
});
