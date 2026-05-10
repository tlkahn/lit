import { describe, it, expect, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { HandlerDeps, ParsedWebhookEvent } from "../../src/types.js";
import { handleWebhook } from "../../src/handlers/webhook.js";
import type Stripe from "stripe";

type VerifyFn = (payload: string, sig: string, secret: string) => Stripe.Event;
type ParseFn = (event: Stripe.Event) => ParsedWebhookEvent;

interface WebhookFns {
  verify: VerifyFn;
  parse: ParseFn;
}

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    db: {
      createLicense: vi.fn().mockImplementation((r) => Promise.resolve(r)),
      getBySessionId: vi.fn().mockResolvedValue(null),
      getByChargeId: vi.fn().mockResolvedValue(null),
      getByLicenseId: vi.fn(),
      getByEmailHash: vi.fn(),
      revokeLicense: vi.fn(),
    },
    stripe: {
      sessions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "cs_test_123",
          payment_status: "paid",
          customer_email: "alice@example.com",
          customer_details: { name: "Alice", email: "alice@example.com" },
          created: 900,
          payment_intent: { id: "pi_123", latest_charge: "ch_456" },
        }),
      },
      checkout: { create: vi.fn() },
    },
    email: {
      sendLicenseEmail: vi.fn().mockResolvedValue(undefined),
      sendRecoveryEmail: vi.fn(),
    },
    config: {
      tableName: "test-table",
      privateKey: new Uint8Array(32),
      stripeSecretKey: "sk_test",
      webhookSecret: "whsec_test",
      baseUrl: "https://example.com",
      sesFromEmail: "noreply@example.com",
      stripePriceId: "price_test",
    },
    clock: {
      nowEpochSeconds: vi.fn().mockReturnValue(1000),
      isOlderThan: vi.fn().mockReturnValue(false),
    },
    generateLicenseKey: vi.fn().mockReturnValue("-----BEGIN LICENSE KEY-----\nfake\n-----END LICENSE KEY-----"),
    generateLicenseId: vi.fn().mockReturnValue("LIT-2025-ABCD1234"),
    computeEmailHash: vi.fn().mockReturnValue("abc123"),
    ...overrides,
  };
}

function makeEvent(
  body?: string,
  signature?: string,
): APIGatewayProxyEvent {
  return {
    body: body ?? '{"type":"test"}',
    headers: signature ? { "stripe-signature": signature } : {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/api/webhook",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

function makeFns(overrides: Partial<WebhookFns> = {}): WebhookFns {
  return {
    verify: vi.fn().mockReturnValue({ type: "test", data: { object: {} } }),
    parse: vi.fn().mockReturnValue({ type: null }),
    ...overrides,
  };
}

describe("handleWebhook", () => {
  it("returns 400 when stripe-signature header missing", async () => {
    const deps = makeDeps();
    const fns = makeFns();

    const result = await handleWebhook(deps, makeEvent('{}'), fns.verify, fns.parse);

    expect(result.statusCode).toBe(400);
  });

  it("calls verifyWebhookEvent with payload, signature, and secret", async () => {
    const deps = makeDeps();
    const fns = makeFns();

    await handleWebhook(deps, makeEvent('{"type":"test"}', "sig_abc"), fns.verify, fns.parse);

    expect(fns.verify).toHaveBeenCalledWith('{"type":"test"}', "sig_abc", "whsec_test");
  });

  it("checkout.session.completed: generates license if not exists", async () => {
    const deps = makeDeps();
    const fns = makeFns({
      parse: vi.fn().mockReturnValue({ type: "checkout.session.completed", sessionId: "cs_test_123" }),
    });

    const result = await handleWebhook(deps, makeEvent('{}', "sig_ok"), fns.verify, fns.parse);

    expect(result.statusCode).toBe(200);
    expect(deps.stripe.sessions.retrieve).toHaveBeenCalledWith("cs_test_123");
    expect(deps.db.createLicense).toHaveBeenCalled();
  });

  it("checkout.session.completed: no-op if license exists", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        getBySessionId: vi.fn().mockResolvedValue({
          license_id: "LIT-2025-EXISTS",
          status: "active",
        }),
      },
    });
    const fns = makeFns({
      parse: vi.fn().mockReturnValue({ type: "checkout.session.completed", sessionId: "cs_test_123" }),
    });

    const result = await handleWebhook(deps, makeEvent('{}', "sig_ok"), fns.verify, fns.parse);

    expect(result.statusCode).toBe(200);
    expect(deps.db.createLicense).not.toHaveBeenCalled();
  });

  it("charge.refunded: revokes with reason 'refund'", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        getByChargeId: vi.fn().mockResolvedValue({
          license_id: "LIT-2025-ABCD1234",
          status: "active",
        }),
      },
    });
    const fns = makeFns({
      parse: vi.fn().mockReturnValue({ type: "charge.refunded", chargeId: "ch_456" }),
    });

    const result = await handleWebhook(deps, makeEvent('{}', "sig_ok"), fns.verify, fns.parse);

    expect(result.statusCode).toBe(200);
    expect(deps.db.getByChargeId).toHaveBeenCalledWith("ch_456");
    expect(deps.db.revokeLicense).toHaveBeenCalledWith("LIT-2025-ABCD1234", "refund");
  });

  it("charge.refunded: returns 200 even if no license found", async () => {
    const deps = makeDeps();
    const fns = makeFns({
      parse: vi.fn().mockReturnValue({ type: "charge.refunded", chargeId: "ch_unknown" }),
    });

    const result = await handleWebhook(deps, makeEvent('{}', "sig_ok"), fns.verify, fns.parse);

    expect(result.statusCode).toBe(200);
    expect(deps.db.revokeLicense).not.toHaveBeenCalled();
  });

  it("charge.dispute.created: revokes with reason 'dispute'", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        getByChargeId: vi.fn().mockResolvedValue({
          license_id: "LIT-2025-ABCD1234",
          status: "active",
        }),
      },
    });
    const fns = makeFns({
      parse: vi.fn().mockReturnValue({ type: "charge.dispute.created", chargeId: "ch_789" }),
    });

    const result = await handleWebhook(deps, makeEvent('{}', "sig_ok"), fns.verify, fns.parse);

    expect(result.statusCode).toBe(200);
    expect(deps.db.getByChargeId).toHaveBeenCalledWith("ch_789");
    expect(deps.db.revokeLicense).toHaveBeenCalledWith("LIT-2025-ABCD1234", "dispute");
  });

  it("unhandled event: returns 200", async () => {
    const deps = makeDeps();
    const fns = makeFns({
      parse: vi.fn().mockReturnValue({ type: null }),
    });

    const result = await handleWebhook(deps, makeEvent('{}', "sig_ok"), fns.verify, fns.parse);

    expect(result.statusCode).toBe(200);
    expect(deps.db.createLicense).not.toHaveBeenCalled();
    expect(deps.db.revokeLicense).not.toHaveBeenCalled();
  });

  it("always returns 200 even on internal errors (prevent Stripe retry flood)", async () => {
    const deps = makeDeps({
      stripe: {
        sessions: {
          retrieve: vi.fn().mockRejectedValue(new Error("DB explosion")),
        },
        checkout: { create: vi.fn() },
      },
    });
    const fns = makeFns({
      parse: vi.fn().mockReturnValue({ type: "checkout.session.completed", sessionId: "cs_test_123" }),
    });

    const result = await handleWebhook(deps, makeEvent('{}', "sig_ok"), fns.verify, fns.parse);

    expect(result.statusCode).toBe(200);
  });

  it("returns 400 on invalid signature", async () => {
    const deps = makeDeps();
    const fns = makeFns({
      verify: vi.fn().mockImplementation(() => {
        throw new Error("Invalid signature");
      }),
    });

    const result = await handleWebhook(deps, makeEvent('{}', "bad_sig"), fns.verify, fns.parse);

    expect(result.statusCode).toBe(400);
  });
});
