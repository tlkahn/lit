import { describe, it, expect } from "vitest";
import {
  licenseEmailHtml,
  licenseEmailText,
  recoveryEmailHtml,
  recoveryEmailText,
} from "../../src/email/templates.js";

const pem = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAtest1234567890abcdef
-----END PUBLIC KEY-----`;

describe("licenseEmailHtml", () => {
  it("contains the PEM in a <pre> block", () => {
    const html = licenseEmailHtml("Alice", pem);
    expect(html).toContain(`<pre>${pem}</pre>`);
  });

  it("includes the user's name in a greeting", () => {
    const html = licenseEmailHtml("Alice", pem);
    expect(html).toContain("Alice");
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
    const html = recoveryEmailHtml("Bob", pem);
    expect(html).toContain(`<pre>${pem}</pre>`);
    expect(html).toContain("Bob");
  });
});

describe("recoveryEmailText", () => {
  it("returns recovery plain text with PEM", () => {
    const text = recoveryEmailText("Bob", pem);
    expect(text).toContain(pem);
    expect(text).toContain("Bob");
    expect(text).not.toMatch(/<pre>|<html>|<\/?\w+>/);
  });
});
