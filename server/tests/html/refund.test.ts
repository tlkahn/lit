import { describe, it, expect } from "vitest";
import { refundPageHtml } from "../../src/html/refund.js";

describe("refundPageHtml", () => {
  it("has proper HTML document structure", () => {
    const html = refundPageHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Refund Policy — Lit</title>");
  });

  it("states 14-day refund window", () => {
    const html = refundPageHtml();
    expect(html).toContain("14");
    expect(html.toLowerCase()).toContain("refund");
  });

  it("explains how to request a refund", () => {
    const html = refundPageHtml();
    expect(html).toContain("privacy@lit.solar");
  });

  it("explains what happens after revocation", () => {
    const html = refundPageHtml();
    expect(html).toContain("revoked");
    expect(html).toContain("export");
  });

  it("names the legal entity", () => {
    const html = refundPageHtml();
    expect(html).toContain("Lit Solar Software LLC");
  });

  it("links to privacy policy", () => {
    const html = refundPageHtml();
    expect(html).toContain('href="/privacy"');
  });
});
