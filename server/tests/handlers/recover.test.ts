import { describe, it, expect, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { HandlerDeps } from "../../src/types.js";
import { handleRecover } from "../../src/handlers/recover.js";

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    db: {
      createLicense: vi.fn(),
      getBySessionId: vi.fn(),
      getByChargeId: vi.fn(),
      getByLicenseId: vi.fn(),
      getByEmailHash: vi.fn().mockResolvedValue([]),
      revokeLicense: vi.fn(),
    },
    stripe: {
      sessions: { retrieve: vi.fn() },
      checkout: { create: vi.fn() },
    },
    email: {
      sendLicenseEmail: vi.fn(),
      sendRecoveryEmail: vi.fn().mockResolvedValue(undefined),
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
    computeEmailHash: vi.fn().mockReturnValue("hashed_email"),
    ...overrides,
  };
}

function makeEvent(body?: string): APIGatewayProxyEvent {
  return {
    body: body ?? null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/api/recover",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

describe("handleRecover", () => {
  it("returns 400 when email missing from body", async () => {
    const deps = makeDeps();
    const result = await handleRecover(deps, makeEvent());

    expect(result.statusCode).toBe(400);
  });

  it("sends recovery email when active license found", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        getByEmailHash: vi.fn().mockResolvedValue([
          {
            license_id: "LIT-2025-ABCD1234",
            status: "active",
            license_key_pem: "-----BEGIN LICENSE KEY-----\nfake\n-----END LICENSE KEY-----",
          },
        ]),
      },
    });

    await handleRecover(deps, makeEvent(JSON.stringify({ email: "alice@example.com" })));

    expect(deps.email.sendRecoveryEmail).toHaveBeenCalledWith(
      "alice@example.com",
      "-----BEGIN LICENSE KEY-----\nfake\n-----END LICENSE KEY-----",
    );
  });

  it("does NOT send email when no license found", async () => {
    const deps = makeDeps();

    await handleRecover(deps, makeEvent(JSON.stringify({ email: "nobody@example.com" })));

    expect(deps.email.sendRecoveryEmail).not.toHaveBeenCalled();
  });

  it("returns identical 200 for match and no-match (prevent enumeration)", async () => {
    const depsWithMatch = makeDeps({
      db: {
        ...makeDeps().db,
        getByEmailHash: vi.fn().mockResolvedValue([
          { license_id: "LIT-2025-ABCD1234", status: "active", license_key_pem: "pem" },
        ]),
      },
    });
    const depsNoMatch = makeDeps();

    const resultMatch = await handleRecover(
      depsWithMatch,
      makeEvent(JSON.stringify({ email: "alice@example.com" })),
    );
    const resultNoMatch = await handleRecover(
      depsNoMatch,
      makeEvent(JSON.stringify({ email: "nobody@example.com" })),
    );

    expect(resultMatch.statusCode).toBe(200);
    expect(resultNoMatch.statusCode).toBe(200);
    expect(resultMatch.body).toBe(resultNoMatch.body);
  });

  it("does not send for revoked licenses", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        getByEmailHash: vi.fn().mockResolvedValue([
          {
            license_id: "LIT-2025-ABCD1234",
            status: "revoked",
            revoked_reason: "refund",
            license_key_pem: "pem",
          },
        ]),
      },
    });

    await handleRecover(deps, makeEvent(JSON.stringify({ email: "alice@example.com" })));

    expect(deps.email.sendRecoveryEmail).not.toHaveBeenCalled();
  });

  it("computes email hash and queries GSI", async () => {
    const deps = makeDeps();
    await handleRecover(deps, makeEvent(JSON.stringify({ email: "alice@example.com" })));

    expect(deps.computeEmailHash).toHaveBeenCalledWith("alice@example.com");
    expect(deps.db.getByEmailHash).toHaveBeenCalledWith("hashed_email");
  });

  it("returns 400 when body has no email field", async () => {
    const deps = makeDeps();
    const result = await handleRecover(deps, makeEvent(JSON.stringify({ name: "Alice" })));

    expect(result.statusCode).toBe(400);
  });
});
