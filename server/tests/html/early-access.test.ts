import { describe, it, expect } from "vitest";
import {
  earlyAccessFormHtml,
  earlyAccessConfirmationHtml,
  earlyAccessClosedHtml,
} from "../../src/html/early-access.js";

describe("earlyAccessFormHtml", () => {
  it("contains a form with email input", () => {
    const html = earlyAccessFormHtml();
    expect(html).toContain("<form");
    expect(html).toContain('type="email"');
  });

  it("posts to /api/early-access", () => {
    const html = earlyAccessFormHtml();
    expect(html).toContain('action="/api/early-access"');
    expect(html).toContain('method="POST"');
  });

  it("has proper HTML document structure", () => {
    const html = earlyAccessFormHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
  });

  it("title contains Early Access", () => {
    const html = earlyAccessFormHtml();
    expect(html).toContain("Early Access");
  });
});

describe("earlyAccessConfirmationHtml", () => {
  it("contains check your email message", () => {
    const html = earlyAccessConfirmationHtml();
    expect(html.toLowerCase()).toContain("check your email");
  });

  it("has proper HTML document structure", () => {
    const html = earlyAccessConfirmationHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
  });
});

describe("earlyAccessClosedHtml", () => {
  it("contains closed or ended messaging", () => {
    const html = earlyAccessClosedHtml();
    const lower = html.toLowerCase();
    expect(lower.match(/closed|ended/)).toBeTruthy();
  });

  it("has proper HTML document structure", () => {
    const html = earlyAccessClosedHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
  });
});
