import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateTurnstile } from "../../src/lib/turnstile.js";

describe("validateTurnstile", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns true when Cloudflare responds with success: true", async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    } as Response);

    const result = await validateTurnstile("secret_123", "token_abc");
    expect(result).toBe(true);
  });

  it("returns false when Cloudflare responds with success: false", async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve({ success: false }),
    } as Response);

    const result = await validateTurnstile("secret_123", "token_abc");
    expect(result).toBe(false);
  });

  it("POSTs to Cloudflare siteverify with correct payload", async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    } as Response);

    await validateTurnstile("sec_test", "tok_test");

    expect(fetch).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: "sec_test", response: "tok_test" }),
      },
    );
  });

  it("returns false when fetch throws", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network error"));

    const result = await validateTurnstile("secret_123", "token_abc");
    expect(result).toBe(false);
  });
});
