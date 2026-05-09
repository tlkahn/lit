import { generateLicenseId } from "../../src/lib/license-id.js";

describe("generateLicenseId", () => {
  it("matches LIT-YYYY-XXXXXXXX format", () => {
    const id = generateLicenseId();
    expect(id).toMatch(/^LIT-\d{4}-[A-Z0-9]{8}$/);
  });

  it("uses current year", () => {
    const id = generateLicenseId();
    const year = new Date().getFullYear().toString();
    expect(id).toContain(`LIT-${year}-`);
  });

  it("produces 100 unique values from 100 calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateLicenseId()));
    expect(ids.size).toBe(100);
  });

  it("accepts optional year override", () => {
    const id = generateLicenseId(2099);
    expect(id).toMatch(/^LIT-2099-[A-Z0-9]{8}$/);
  });
});
