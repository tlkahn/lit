import { createHash } from "node:crypto";
import { computeEmailHash } from "../../src/lib/email-hash.js";

describe("computeEmailHash", () => {
  it("equals SHA-256 hex of lowercased trimmed email", () => {
    const expected = createHash("sha256")
      .update("user@example.com")
      .digest("hex");
    expect(computeEmailHash("User@Example.COM")).toBe(expected);
  });

  it("produces identical hash for different casings", () => {
    expect(computeEmailHash("USER@EXAMPLE.COM")).toBe(
      computeEmailHash("user@example.com"),
    );
  });

  it("produces 64-char hex string", () => {
    const hash = computeEmailHash("test@example.com");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
