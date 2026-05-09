import { describe, it, expect } from "vitest";
import {
  successPageHtml,
  gonePageHtml,
} from "../../src/html/success.js";

const pem = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAtest1234567890abcdef
-----END PUBLIC KEY-----`;

describe("successPageHtml", () => {
  it("contains PEM inside <pre>", () => {
    const html = successPageHtml(pem, "Alice");
    expect(html).toContain(`<pre>${pem}</pre>`);
  });

  it("contains a lit:// activation link with encoded PEM", () => {
    const html = successPageHtml(pem, "Alice");
    expect(html).toContain(
      `lit://activate?key=${encodeURIComponent(pem)}`,
    );
    expect(html).toContain("Open in Lit");
  });

  it("contains copy instructions", () => {
    const html = successPageHtml(pem, "Alice");
    expect(html.toLowerCase()).toContain("copy");
  });

  it("mentions email", () => {
    const html = successPageHtml(pem, "Alice");
    expect(html.toLowerCase()).toContain("email");
  });

  it("escapes HTML in name to prevent XSS", () => {
    const html = successPageHtml(pem, "<script>alert('xss')</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("has proper HTML document structure", () => {
    const html = successPageHtml(pem, "Alice");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>License Key — Lit</title>");
  });

  it("escapes HTML characters in PEM inside <pre>", () => {
    const html = successPageHtml("fake<pem>&stuff", "Alice");
    expect(html).toContain("<pre>fake&lt;pem&gt;&amp;stuff</pre>");
    expect(html).not.toContain("<pre>fake<pem>");
  });
});

describe("gonePageHtml", () => {
  it("contains expired message", () => {
    const html = gonePageHtml();
    expect(html.toLowerCase()).toContain("expired");
  });

  it("mentions email", () => {
    const html = gonePageHtml();
    expect(html.toLowerCase()).toContain("email");
  });

  it("has proper HTML document structure", () => {
    const html = gonePageHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Link Expired — Lit</title>");
  });
});
