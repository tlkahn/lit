import { describe, it, expect, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { HandlerDeps, LicenseRecord } from "../../src/types.js";
import { handleLicense } from "../../src/handlers/license.js";
import { IdempotencyError } from "../../src/db/errors.js";

const fakePem = "-----BEGIN LICENSE KEY-----\nfake\n-----END LICENSE KEY-----";

const activeRecord: LicenseRecord = {
  license_id: "LIT-2025-ABCD1234",
  email_hash: "abc123",
  stripe_session_id: "cs_test_123",
  stripe_charge_id: "ch_456",
  status: "active",
  license_key_pem: fakePem,
  issued_at: 900,
  updated_at: 900,
};

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    db: {
      createLicense: vi.fn().mockImplementation((r) => Promise.resolve(r)),
      getBySessionId: vi.fn().mockResolvedValue(null),
      getByChargeId: vi.fn(),
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
    generateLicenseKey: vi.fn().mockReturnValue(fakePem),
    generateLicenseId: vi.fn().mockReturnValue("LIT-2025-ABCD1234"),
    computeEmailHash: vi.fn().mockReturnValue("abc123"),
    ...overrides,
  };
}

function makeEvent(sessionId?: string): APIGatewayProxyEvent {
  return {
    queryStringParameters: sessionId ? { session_id: sessionId } : null,
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/api/license",
    pathParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

describe("handleLicense", () => {
  it("returns 400 when session_id param missing", async () => {
    const deps = makeDeps();
    const result = await handleLicense(deps, makeEvent());

    expect(result.statusCode).toBe(400);
    expect(result.body).toContain("session_id");
  });

  it("calls Stripe sessions.retrieve with session_id", async () => {
    const deps = makeDeps();
    await handleLicense(deps, makeEvent("cs_test_123"));

    expect(deps.stripe.sessions.retrieve).toHaveBeenCalledWith("cs_test_123");
  });

  it("generates new license and returns 200 with license_key_pem", async () => {
    const deps = makeDeps();

    const result = await handleLicense(deps, makeEvent("cs_test_123"));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.license_key_pem).toBe(fakePem);
    expect(deps.generateLicenseId).toHaveBeenCalled();
    expect(deps.generateLicenseKey).toHaveBeenCalled();
    expect(deps.db.createLicense).toHaveBeenCalled();
    expect(deps.email.sendLicenseEmail).toHaveBeenCalled();
  });

  it("returns existing license if already generated (idempotent)", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        getBySessionId: vi.fn().mockResolvedValue(activeRecord),
      },
    });

    const result = await handleLicense(deps, makeEvent("cs_test_123"));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.license_key_pem).toBe(fakePem);
    expect(deps.generateLicenseKey).not.toHaveBeenCalled();
  });

  it("handles IdempotencyError by fetching existing license", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        createLicense: vi.fn().mockRejectedValue(new IdempotencyError()),
        getBySessionId: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(activeRecord),
      },
    });

    const result = await handleLicense(deps, makeEvent("cs_test_123"));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.license_key_pem).toBe(fakePem);
  });

  it("returns 410 when session older than 1 hour", async () => {
    const deps = makeDeps({
      clock: {
        nowEpochSeconds: vi.fn().mockReturnValue(9999),
        isOlderThan: vi.fn().mockReturnValue(true),
      },
    });

    const result = await handleLicense(deps, makeEvent("cs_test_123"));

    expect(result.statusCode).toBe(410);
    expect(deps.clock.isOlderThan).toHaveBeenCalledWith(900, 3600);
  });

  it("returns 500 when Stripe sessions.retrieve throws", async () => {
    const deps = makeDeps({
      stripe: {
        sessions: { retrieve: vi.fn().mockRejectedValue(new Error("Stripe API error")) },
        checkout: { create: vi.fn() },
      },
    });
    const result = await handleLicense(deps, makeEvent("cs_test_123"));
    expect(result.statusCode).toBe(500);
    expect(result.body).toContain("Internal server error");
  });

  it("returns 500 when license generation throws non-IdempotencyError", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        createLicense: vi.fn().mockRejectedValue(new Error("DynamoDB timeout")),
      },
    });
    const result = await handleLicense(deps, makeEvent("cs_test_123"));
    expect(result.statusCode).toBe(500);
    expect(result.body).toContain("Internal server error");
  });

  it("returns 402 when payment not paid", async () => {
    const deps = makeDeps({
      stripe: {
        sessions: {
          retrieve: vi.fn().mockResolvedValue({
            id: "cs_test_123",
            payment_status: "unpaid",
            customer_email: "alice@example.com",
            created: 900,
          }),
        },
        checkout: { create: vi.fn() },
      },
    });

    const result = await handleLicense(deps, makeEvent("cs_test_123"));

    expect(result.statusCode).toBe(402);
  });
});
