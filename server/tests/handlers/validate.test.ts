import { describe, it, expect, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { HandlerDeps } from "../../src/types.js";
import { handleValidate } from "../../src/handlers/validate.js";

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    db: {
      createLicense: vi.fn(),
      getBySessionId: vi.fn(),
      getByChargeId: vi.fn(),
      getByLicenseId: vi.fn().mockResolvedValue(null),
      getByEmailHash: vi.fn(),
      revokeLicense: vi.fn(),
    },
    stripe: {
      sessions: { retrieve: vi.fn() },
      checkout: { create: vi.fn() },
    },
    email: {
      sendLicenseEmail: vi.fn(),
      sendRecoveryEmail: vi.fn(),
      sendEarlyAdopterEmail: vi.fn(),
      sendTrialEmail: vi.fn(),
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

function makeEvent(licenseId?: string): APIGatewayProxyEvent {
  return {
    queryStringParameters: licenseId ? { license_id: licenseId } : null,
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/api/validate",
    pathParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

describe("handleValidate", () => {
  it("returns 400 when license_id param missing", async () => {
    const deps = makeDeps();
    const result = await handleValidate(deps, makeEvent());

    expect(result.statusCode).toBe(400);
    expect(result.body).toContain("license_id");
  });

  it("returns { status: 'valid' } for active license", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        getByLicenseId: vi.fn().mockResolvedValue({
          license_id: "LIT-2025-ABCD1234",
          status: "active",
        }),
      },
    });

    const result = await handleValidate(deps, makeEvent("LIT-2025-ABCD1234"));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ status: "valid" });
  });

  it("returns { status: 'revoked', reason: 'refund' } for revoked license", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        getByLicenseId: vi.fn().mockResolvedValue({
          license_id: "LIT-2025-ABCD1234",
          status: "revoked",
          revoked_reason: "refund",
        }),
      },
    });

    const result = await handleValidate(deps, makeEvent("LIT-2025-ABCD1234"));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ status: "revoked", reason: "refund" });
  });

  it("returns { status: 'valid' } for nonexistent ID (prevent enumeration)", async () => {
    const deps = makeDeps();

    const result = await handleValidate(deps, makeEvent("LIT-2025-UNKNOWN"));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ status: "valid" });
  });
});
