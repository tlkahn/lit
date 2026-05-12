import { describe, it, expect } from "vitest";
import { buyPageHtml } from "../../src/html/buy.js";

describe("buyPageHtml", () => {
  it("has proper HTML document structure", () => {
    const html = buyPageHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("Lit");
    expect(html).toContain("<title>");
  });

  it("has form posting to /api/checkout", () => {
    const html = buyPageHtml();
    expect(html).toContain('action="/api/checkout"');
    expect(html).toContain('method="POST"');
  });

  it("submit button contains $29", () => {
    const html = buyPageHtml();
    expect(html).toContain("$29");
  });

  it("includes Turnstile widget when siteKey is provided", () => {
    const html = buyPageHtml("0x_test");
    expect(html).toContain("challenges.cloudflare.com/turnstile");
    expect(html).toContain("cf-turnstile");
    expect(html).toContain('data-sitekey="0x_test"');
  });

  it("omits Turnstile widget when siteKey is undefined", () => {
    const html = buyPageHtml();
    expect(html).not.toContain("cf-turnstile");
    expect(html).not.toContain("challenges.cloudflare.com");
  });

  it("escapes HTML-special characters in siteKey", () => {
    const html = buyPageHtml('"><script>alert(1)</script>');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("links to privacy and refund pages", () => {
    const html = buyPageHtml();
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/refund"');
  });
});
