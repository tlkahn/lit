import { describe, it, expect, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { HandlerDeps } from "../../src/types.js";
import { handleSuccessPage } from "../../src/handlers/success-page.js";

const pem = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAtest1234567890abcdef
-----END PUBLIC KEY-----`;

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    db: {
      createLicense: vi.fn(),
      getBySessionId: vi.fn().mockResolvedValue({
        license_id: "LIT-2025-0001",
        license_key_pem: pem,
        email_hash: "abc",
        stripe_session_id: "cs_test_123",
        stripe_charge_id: "ch_test",
        status: "active" as const,
        issued_at: 1000,
        updated_at: 1000,
      }),
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
          created: 1000,
        }),
      },
      checkout: { create: vi.fn() },
    },
    email: {
      sendLicenseEmail: vi.fn(),
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
      nowEpochSeconds: vi.fn().mockReturnValue(2000),
      isOlderThan: vi.fn().mockReturnValue(false),
    },
    generateLicenseKey: vi.fn(),
    generateLicenseId: vi.fn(),
    computeEmailHash: vi.fn(),
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
    path: "/success",
    pathParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

describe("handleSuccessPage", () => {
  it("returns 200 with HTML containing PEM and name", async () => {
    const deps = makeDeps();
    const result = await handleSuccessPage(deps, makeEvent("cs_test_123"));

    expect(result.statusCode).toBe(200);
    expect(result.headers?.["Content-Type"]).toBe("text/html");
    expect(result.body).toContain(pem);
    expect(result.body).toContain("Alice");
  });

  it("returns 410 with gone page when session is expired", async () => {
    const deps = makeDeps({
      clock: {
        nowEpochSeconds: vi.fn().mockReturnValue(9999),
        isOlderThan: vi.fn().mockReturnValue(true),
      },
    });

    const result = await handleSuccessPage(deps, makeEvent("cs_test_123"));

    expect(result.statusCode).toBe(410);
    expect(result.body.toLowerCase()).toContain("expired");
    expect(result.body.toLowerCase()).toContain("email");
    expect(deps.clock.isOlderThan).toHaveBeenCalledWith(1000, 3600);
  });

  it("returns 400 when session_id is missing", async () => {
    const deps = makeDeps();
    const result = await handleSuccessPage(deps, makeEvent());

    expect(result.statusCode).toBe(400);
    expect(result.body).toContain("session_id");
  });

  it("returns 400 when queryStringParameters is null", async () => {
    const deps = makeDeps();
    const event = makeEvent();
    event.queryStringParameters = null;

    const result = await handleSuccessPage(deps, event);

    expect(result.statusCode).toBe(400);
    expect(result.body).toContain("session_id");
  });

  it("returns 404 when no license record found", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        getBySessionId: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await handleSuccessPage(deps, makeEvent("cs_test_123"));

    expect(result.statusCode).toBe(404);
  });

  it("returns 500 with error page when Stripe throws", async () => {
    const deps = makeDeps({
      stripe: {
        sessions: {
          retrieve: vi.fn().mockRejectedValue(new Error("Stripe API error")),
        },
        checkout: { create: vi.fn() },
      },
    });

    const result = await handleSuccessPage(deps, makeEvent("cs_test_123"));

    expect(result.statusCode).toBe(500);
    expect(result.headers?.["Content-Type"]).toBe("text/html");
    expect(result.body.toLowerCase()).toContain("something went wrong");
  });

  it("returns 500 with error page when DB throws", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        getBySessionId: vi.fn().mockRejectedValue(new Error("DynamoDB timeout")),
      },
    });

    const result = await handleSuccessPage(deps, makeEvent("cs_test_123"));

    expect(result.statusCode).toBe(500);
    expect(result.body.toLowerCase()).toContain("something went wrong");
  });

  it("falls back to 'Customer' when name is missing", async () => {
    const deps = makeDeps({
      stripe: {
        sessions: {
          retrieve: vi.fn().mockResolvedValue({
            id: "cs_test_123",
            payment_status: "paid",
            customer_email: "alice@example.com",
            customer_details: { name: null },
            created: 1000,
          }),
        },
        checkout: { create: vi.fn() },
      },
    });

    const result = await handleSuccessPage(deps, makeEvent("cs_test_123"));

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain("Customer");
  });
});
