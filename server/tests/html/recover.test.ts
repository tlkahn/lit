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
});

describe("recoverResultPageHtml", () => {
  it("shows a generic check-your-email message", () => {
    const html = recoverResultPageHtml();
    expect(html.toLowerCase()).toContain("check your email");
  });
});
