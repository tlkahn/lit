import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  licenseEmailHtml,
  licenseEmailText,
  recoveryEmailHtml,
  recoveryEmailText,
} from "../../src/email/templates.js";

const pem = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAtest1234567890abcdef
-----END PUBLIC KEY-----`;

describe("escapeHtml", () => {
  it("escapes &, <, >, \", and ' characters", () => {
    const result = escapeHtml(`<script>alert("xss")</script> & it's bad`);
    expect(result).toBe(
      `&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; it&#39;s bad`,
    );
  });

  it("returns the string unchanged when it contains no special characters", () => {
    expect(escapeHtml("Alice Johnson")).toBe("Alice Johnson");
  });
});

describe("licenseEmailHtml", () => {
  it("contains the PEM in a <pre> block", () => {
    const html = licenseEmailHtml("Alice", pem);
    expect(html).toContain(`<pre>${pem}</pre>`);
  });

  it("includes the user's name in a greeting", () => {
    const html = licenseEmailHtml("Alice", pem);
    expect(html).toContain("Alice");
  });

  it("escapes HTML metacharacters in the name", () => {
    const html = licenseEmailHtml('<img src=x onerror="alert(1)">', pem);
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("licenseEmailText", () => {
  it("returns a plain text version with the PEM", () => {
    const text = licenseEmailText("Alice", pem);
    expect(text).toContain(pem);
    expect(text).toContain("Alice");
    expect(text).not.toMatch(/<pre>|<html>|<\/?\w+>/);
  });
});

describe("recoveryEmailHtml", () => {
  it("returns recovery HTML containing the PEM in a <pre> block", () => {
    const html = recoveryEmailHtml(pem);
    expect(html).toContain(`<pre>${pem}</pre>`);
  });

  it("uses a generic greeting without a name", () => {
    const html = recoveryEmailHtml(pem);
    expect(html).toContain("Hello,");
    expect(html).not.toContain("Customer");
  });
});

describe("licenseEmailText", () => {
  it("does not escape HTML characters in name (plain text)", () => {
    const text = licenseEmailText("O'Brien <admin>", pem);
    expect(text).toContain("O'Brien <admin>");
  });
});

describe("recoveryEmailText", () => {
  it("returns recovery plain text with PEM", () => {
    const text = recoveryEmailText(pem);
    expect(text).toContain(pem);
    expect(text).toContain("Hello,");
    expect(text).not.toMatch(/<pre>|<html>|<\/?\w+>/);
  });
});
