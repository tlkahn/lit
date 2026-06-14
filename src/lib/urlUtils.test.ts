import { describe, it, expect } from "vitest";
import { doiHref, isHttpUrl } from "./urlUtils";

describe("doiHref", () => {
  it("prepends https://doi.org/ for bare DOI", () => {
    expect(doiHref("10.1000/xyz123")).toBe("https://doi.org/10.1000/xyz123");
  });

  it("passes through DOI that already has https://", () => {
    expect(doiHref("https://doi.org/10.1000/xyz123")).toBe(
      "https://doi.org/10.1000/xyz123",
    );
  });

  it("passes through DOI that has http://", () => {
    expect(doiHref("http://doi.org/10.1000/xyz123")).toBe(
      "http://doi.org/10.1000/xyz123",
    );
  });

  it("strips leading doi: prefix", () => {
    expect(doiHref("doi:10.1000/xyz123")).toBe("https://doi.org/10.1000/xyz123");
  });

  it("strips leading DOI: prefix (case-insensitive)", () => {
    expect(doiHref("DOI:10.1000/xyz123")).toBe("https://doi.org/10.1000/xyz123");
  });

  it("trims surrounding whitespace", () => {
    expect(doiHref(" 10.1000/xyz123 ")).toBe("https://doi.org/10.1000/xyz123");
  });

  it("strips doi: prefix and trims whitespace together", () => {
    expect(doiHref(" doi:10.1000/xyz123 ")).toBe("https://doi.org/10.1000/xyz123");
  });
});

describe("isHttpUrl", () => {
  it("accepts https URLs", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
  });

  it("accepts http URLs", () => {
    expect(isHttpUrl("http://example.com")).toBe(true);
  });

  it("rejects ftp URLs", () => {
    expect(isHttpUrl("ftp://example.com")).toBe(false);
  });

  it("rejects non-URL strings", () => {
    expect(isHttpUrl("not a url")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isHttpUrl("")).toBe(false);
  });
});
