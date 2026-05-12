import { describe, it, expect, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { HandlerDeps } from "../../src/types.js";

vi.mock("../../src/lib/turnstile.js", () => ({
  validateTurnstile: vi.fn().mockResolvedValue(true),
}));

import { handleCheckout } from "../../src/handlers/checkout.js";
import { validateTurnstile } from "../../src/lib/turnstile.js";

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    db: {
      createLicense: vi.fn(),
      getBySessionId: vi.fn(),
      getByChargeId: vi.fn(),
      getByLicenseId: vi.fn(),
      getByEmailHash: vi.fn(),
      revokeLicense: vi.fn(),
    },
    stripe: {
      sessions: { retrieve: vi.fn() },
      checkout: {
        create: vi.fn().mockResolvedValue({
          url: "https://checkout.stripe.com/pay/cs_test_abc",
          id: "cs_test_abc",
        }),
      },
    },
    email: {
      sendLicenseEmail: vi.fn(),
      sendRecoveryEmail: vi.fn(),
      sendEarlyAdopterEmail: vi.fn(),
    },
    config: {
      tableName: "test-table",
      privateKey: new Uint8Array(32),
      stripeSecretKey: "sk_test",
      webhookSecret: "whsec_test",
      baseUrl: "https://example.com",
      sesFromEmail: "noreply@example.com",
      stripePriceId: "price_test",
      earlyAccessDeadline: 2000000000,
    },
    clock: {
      nowEpochSeconds: vi.fn().mockReturnValue(1000),
      isOlderThan: vi.fn().mockReturnValue(false),
    },
    generateLicenseKey: vi.fn(),
    generateLicenseId: vi.fn(),
    computeEmailHash: vi.fn(),
    ...overrides,
  };
}

function makeEvent(body?: string, headers: Record<string, string> = {}): APIGatewayProxyEvent {
  return {
    body: body ?? null,
    headers,
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/api/checkout",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

describe("handleCheckout", () => {
  it("returns 303 redirect to Stripe checkout URL", async () => {
    const deps = makeDeps();

    const result = await handleCheckout(deps, makeEvent());

    expect(result.statusCode).toBe(303);
    expect(result.headers?.Location).toBe("https://checkout.stripe.com/pay/cs_test_abc");
  });

  it("returns 500 on Stripe failure", async () => {
    const deps = makeDeps({
      stripe: {
        sessions: { retrieve: vi.fn() },
        checkout: { create: vi.fn().mockRejectedValue(new Error("Stripe down")) },
      },
    });

    const result = await handleCheckout(deps, makeEvent());

    expect(result.statusCode).toBe(500);
  });

  it("returns 400 on invalid JSON body", async () => {
    const deps = makeDeps();

    const result = await handleCheckout(deps, makeEvent("not json{"));

    expect(result.statusCode).toBe(400);
    expect(deps.stripe.checkout.create).not.toHaveBeenCalled();
  });

  it("passes email from body to checkout.create", async () => {
    const deps = makeDeps();
    const body = JSON.stringify({ email: "alice@example.com" });

    await handleCheckout(deps, makeEvent(body));

    expect(deps.stripe.checkout.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmail: "alice@example.com" }),
    );
  });

  it("parses form-urlencoded body when content-type header is set", async () => {
    const deps = makeDeps();
    const body = "email=alice%40example.com";
    const headers = { "content-type": "application/x-www-form-urlencoded" };

    await handleCheckout(deps, makeEvent(body, headers));

    expect(deps.stripe.checkout.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmail: "alice@example.com" }),
    );
  });

  it("returns 303 for form-urlencoded POST", async () => {
    const deps = makeDeps();
    const body = "email=alice%40example.com";
    const headers = { "content-type": "application/x-www-form-urlencoded" };

    const result = await handleCheckout(deps, makeEvent(body, headers));

    expect(result.statusCode).toBe(303);
    expect(result.headers?.Location).toBe("https://checkout.stripe.com/pay/cs_test_abc");
  });

  it("works with empty form-urlencoded body", async () => {
    const deps = makeDeps();
    const headers = { "content-type": "application/x-www-form-urlencoded" };

    const result = await handleCheckout(deps, makeEvent("", headers));

    expect(result.statusCode).toBe(303);
  });

  it("handles uppercase Content-Type header", async () => {
    const deps = makeDeps();
    const body = "email=bob%40example.com";
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };

    const result = await handleCheckout(deps, makeEvent(body, headers));

    expect(result.statusCode).toBe(303);
    expect(deps.stripe.checkout.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmail: "bob@example.com" }),
    );
  });

  it("skips Turnstile validation when turnstileSecret is not configured", async () => {
    const deps = makeDeps();
    vi.mocked(validateTurnstile).mockClear();

    const result = await handleCheckout(deps, makeEvent());

    expect(validateTurnstile).not.toHaveBeenCalled();
    expect(result.statusCode).toBe(303);
  });

  it("validates Turnstile token when turnstileSecret is configured (form-urlencoded)", async () => {
    const deps = makeDeps({ config: { ...makeDeps().config, turnstileSecret: "tsec_test" } });
    vi.mocked(validateTurnstile).mockResolvedValue(true);
    const body = "email=alice%40example.com&cf-turnstile-response=tok_abc";
    const headers = { "content-type": "application/x-www-form-urlencoded" };

    const result = await handleCheckout(deps, makeEvent(body, headers));

    expect(validateTurnstile).toHaveBeenCalledWith("tsec_test", "tok_abc");
    expect(result.statusCode).toBe(303);
  });

  it("returns 403 when Turnstile validation fails", async () => {
    const deps = makeDeps({ config: { ...makeDeps().config, turnstileSecret: "tsec_test" } });
    vi.mocked(validateTurnstile).mockResolvedValue(false);
    const body = "cf-turnstile-response=tok_bad";
    const headers = { "content-type": "application/x-www-form-urlencoded" };

    const result = await handleCheckout(deps, makeEvent(body, headers));

    expect(result.statusCode).toBe(403);
    expect(deps.stripe.checkout.create).not.toHaveBeenCalled();
  });

  it("returns 403 when Turnstile is configured but token is missing", async () => {
    const deps = makeDeps({ config: { ...makeDeps().config, turnstileSecret: "tsec_test" } });
    const body = "email=alice%40example.com";
    const headers = { "content-type": "application/x-www-form-urlencoded" };

    const result = await handleCheckout(deps, makeEvent(body, headers));

    expect(result.statusCode).toBe(403);
  });

  it("extracts Turnstile token from JSON body", async () => {
    const deps = makeDeps({ config: { ...makeDeps().config, turnstileSecret: "tsec_test" } });
    vi.mocked(validateTurnstile).mockResolvedValue(true);
    const body = JSON.stringify({ email: "a@b.com", "cf-turnstile-response": "tok_json" });

    const result = await handleCheckout(deps, makeEvent(body));

    expect(validateTurnstile).toHaveBeenCalledWith("tsec_test", "tok_json");
    expect(result.statusCode).toBe(303);
  });
});
