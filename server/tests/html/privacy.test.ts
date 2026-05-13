import { describe, it, expect } from "vitest";
import { privacyPageHtml } from "../../src/html/privacy.js";

describe("privacyPageHtml", () => {
  it("has proper HTML document structure", () => {
    const html = privacyPageHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Privacy Policy — Lit</title>");
  });

  it("names the legal entity", () => {
    const html = privacyPageHtml();
    expect(html).toContain("Lit Solar Software LLC");
    expect(html).toContain("Delaware");
  });

  it("documents what is collected", () => {
    const html = privacyPageHtml();
    expect(html).toContain("Email hash");
    expect(html).toContain("SHA-256");
    expect(html).toContain("License key blob");
    expect(html).toContain("Stripe session ID");
  });

  it("documents what is not collected", () => {
    const html = privacyPageHtml();
    expect(html).toContain("do not store your raw email");
    expect(html).toContain("do not collect analytics");
  });

  it("explains how to request deletion", () => {
    const html = privacyPageHtml();
    expect(html).toContain("support@lit.solar");
    expect(html).toContain("deletion");
  });

  it("mentions third parties", () => {
    const html = privacyPageHtml();
    expect(html).toContain("Stripe");
    expect(html).toContain("AWS");
  });

  it("links to refund policy", () => {
    const html = privacyPageHtml();
    expect(html).toContain('href="/refund"');
  });
});
