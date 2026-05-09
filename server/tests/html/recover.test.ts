import { describe, it, expect } from "vitest";
import {
  recoverPageHtml,
  recoverResultPageHtml,
} from "../../src/html/recover.js";

describe("recoverPageHtml", () => {
  it("contains a form with email input", () => {
    const html = recoverPageHtml();
    expect(html).toContain("<form");
    expect(html).toContain('type="email"');
  });

  it("posts to /api/recover", () => {
    const html = recoverPageHtml();
    expect(html).toContain('action="/api/recover"');
    expect(html).toContain('method="POST"');
  });

  it("has proper HTML document structure", () => {
    const html = recoverPageHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Recover License — Lit</title>");
  });
});

describe("recoverResultPageHtml", () => {
  it("shows a generic check-your-email message", () => {
    const html = recoverResultPageHtml();
    expect(html.toLowerCase()).toContain("check your email");
  });

  it("has proper HTML document structure", () => {
    const html = recoverResultPageHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Recovery Submitted — Lit</title>");
  });
});
