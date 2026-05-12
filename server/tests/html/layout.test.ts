import { describe, it, expect } from "vitest";
import { pageHtml } from "../../src/html/layout.js";

describe("pageHtml", () => {
  it("produces a valid HTML5 document", () => {
    const html = pageHtml("Test", "<p>Hello</p>");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("</html>");
  });

  it("sets the title", () => {
    const html = pageHtml("My Title", "<p>body</p>");
    expect(html).toContain("<title>My Title</title>");
  });

  it("includes viewport meta for mobile", () => {
    const html = pageHtml("T", "<p>x</p>");
    expect(html).toContain("viewport");
    expect(html).toContain("width=device-width");
  });

  it("includes Inter font from Google Fonts", () => {
    const html = pageHtml("T", "<p>x</p>");
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("Inter");
  });

  it("includes inline CSS with design tokens", () => {
    const html = pageHtml("T", "<p>x</p>");
    expect(html).toContain("<style>");
    expect(html).toContain("--color-accent:#0071E3");
    expect(html).toContain("--content-width:720px");
    expect(html).toContain("--color-text:#1D1D1F");
  });

  it("wraps body content in a .container div", () => {
    const html = pageHtml("T", "<p>inner</p>");
    expect(html).toContain('<div class="container">');
    expect(html).toContain("<p>inner</p>");
    expect(html).toContain("</div>");
  });

  it("appends headExtra into the <head> when provided", () => {
    const extra = '<script src="https://example.com/lib.js"></script>';
    const html = pageHtml("T", "<p>x</p>", extra);
    expect(html).toContain(extra);
    const headEnd = html.indexOf("</head>");
    const extraPos = html.indexOf(extra);
    expect(extraPos).toBeLessThan(headEnd);
  });

  it("omits headExtra when not provided", () => {
    const html = pageHtml("T", "<p>x</p>");
    const headSection = html.slice(0, html.indexOf("</head>"));
    const scriptCount = (headSection.match(/<script/g) || []).length;
    expect(scriptCount).toBe(0);
  });

  it("includes mobile breakpoint", () => {
    const html = pageHtml("T", "<p>x</p>");
    expect(html).toContain("@media");
    expect(html).toContain("600px");
  });

  it("sets lang attribute on html element", () => {
    const html = pageHtml("T", "<p>x</p>");
    expect(html).toContain('<html lang="en">');
  });

  it("escapes HTML-special characters in title", () => {
    const html = pageHtml("A <b> & C", "<p>x</p>");
    expect(html).toContain("<title>A &lt;b&gt; &amp; C</title>");
    expect(html).not.toContain("<title>A <b> & C</title>");
  });

  it("minifies inline CSS (no consecutive whitespace)", () => {
    const html = pageHtml("T", "<p>x</p>");
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    expect(styleMatch).toBeTruthy();
    const css = styleMatch![1];
    expect(css).not.toMatch(/\s{2,}/);
  });
});
