import { describe, it, expect, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { HandlerDeps } from "../../src/types.js";
import { handleEarlyAccess } from "../../src/handlers/early-access.js";
import { IdempotencyError } from "../../src/db/errors.js";

const fakePem = "-----BEGIN LICENSE KEY-----\nfake\n-----END LICENSE KEY-----";

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    db: {
      createLicense: vi.fn().mockImplementation((r) => Promise.resolve(r)),
      getBySessionId: vi.fn().mockResolvedValue(null),
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
      sendRecoveryEmail: vi.fn(),
      sendEarlyAdopterEmail: vi.fn().mockResolvedValue(undefined),
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
    path: "/api/early-access",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

describe("handleEarlyAccess — validation + deadline", () => {
  it("returns 400 when body is missing", async () => {
    const deps = makeDeps();
    const result = await handleEarlyAccess(deps, makeEvent());
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 when email field is missing", async () => {
    const deps = makeDeps();
    const result = await handleEarlyAccess(deps, makeEvent("name=Alice"));
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 when email is empty", async () => {
    const deps = makeDeps();
    const result = await handleEarlyAccess(deps, makeEvent("email="));
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 when email has no @", async () => {
    const deps = makeDeps();
    const result = await handleEarlyAccess(deps, makeEvent("email=notanemail"));
    expect(result.statusCode).toBe(400);
  });

  it("returns 410 with closed HTML when past deadline", async () => {
    const deps = makeDeps({
      clock: {
        nowEpochSeconds: vi.fn().mockReturnValue(2000000001),
        isOlderThan: vi.fn(),
      },
    });

    const result = await handleEarlyAccess(deps, makeEvent("email=alice%40example.com"));

    expect(result.statusCode).toBe(410);
    expect(result.body.toLowerCase()).toMatch(/closed|ended/);
  });

  it("parses application/x-www-form-urlencoded body", async () => {
    const deps = makeDeps();
    await handleEarlyAccess(deps, makeEvent("email=alice%40example.com"));

    expect(deps.computeEmailHash).toHaveBeenCalledWith("alice@example.com");
  });
});

describe("handleEarlyAccess — new license (happy path)", () => {
  it("generates license with type early_adopter for new email", async () => {
    const deps = makeDeps();
    await handleEarlyAccess(deps, makeEvent("email=alice%40example.com"));

    expect(deps.generateLicenseKey).toHaveBeenCalledWith(
      expect.objectContaining({ type: "early_adopter" }),
      deps.config.privateKey,
    );
  });

  it("stores in DynamoDB with early-access sentinel session ID", async () => {
    const deps = makeDeps();
    await handleEarlyAccess(deps, makeEvent("email=alice%40example.com"));

    expect(deps.db.createLicense).toHaveBeenCalledWith(
      expect.objectContaining({
        stripe_session_id: "early-access:hashed_email",
      }),
    );
    const record = (deps.db.createLicense as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(record).not.toHaveProperty("stripe_charge_id");
  });

  it("sends early-adopter email", async () => {
    const deps = makeDeps();
    await handleEarlyAccess(deps, makeEvent("email=alice%40example.com"));

    expect(deps.email.sendEarlyAdopterEmail).toHaveBeenCalledWith(
      "alice@example.com",
      fakePem,
    );
  });

  it("returns 200 with generic confirmation HTML", async () => {
    const deps = makeDeps();
    const result = await handleEarlyAccess(deps, makeEvent("email=alice%40example.com"));

    expect(result.statusCode).toBe(200);
    expect(result.headers?.["Content-Type"]).toBe("text/html");
    expect(result.body.toLowerCase()).toContain("check your email");
  });

  it("uses computeEmailHash on the raw email", async () => {
    const deps = makeDeps();
    await handleEarlyAccess(deps, makeEvent("email=alice%40example.com"));

    expect(deps.computeEmailHash).toHaveBeenCalledWith("alice@example.com");
  });

  it("license payload uses name Customer", async () => {
    const deps = makeDeps();
    await handleEarlyAccess(deps, makeEvent("email=alice%40example.com"));

    expect(deps.generateLicenseKey).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Customer" }),
      deps.config.privateKey,
    );
  });
});

describe("handleEarlyAccess — existing user re-send", () => {
  it("re-sends existing PEM when active license found", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        getByEmailHash: vi.fn().mockResolvedValue([
          {
            license_id: "LIT-2025-EXISTING",
            status: "active",
            license_key_pem: "-----BEGIN LICENSE KEY-----\nexisting\n-----END LICENSE KEY-----",
          },
        ]),
      },
    });

    await handleEarlyAccess(deps, makeEvent("email=alice%40example.com"));

    expect(deps.email.sendEarlyAdopterEmail).toHaveBeenCalledWith(
      "alice@example.com",
      "-----BEGIN LICENSE KEY-----\nexisting\n-----END LICENSE KEY-----",
    );
  });

  it("does NOT create new license when active license exists", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        getByEmailHash: vi.fn().mockResolvedValue([
          {
            license_id: "LIT-2025-EXISTING",
            status: "active",
            license_key_pem: "existing-pem",
          },
        ]),
      },
    });

    await handleEarlyAccess(deps, makeEvent("email=alice%40example.com"));

    expect(deps.generateLicenseKey).not.toHaveBeenCalled();
    expect(deps.db.createLicense).not.toHaveBeenCalled();
  });

  it("returns identical 200 for both new and existing (prevent enumeration)", async () => {
    const depsNew = makeDeps();
    const depsExisting = makeDeps({
      db: {
        ...makeDeps().db,
        getByEmailHash: vi.fn().mockResolvedValue([
          { license_id: "LIT-2025-EXISTING", status: "active", license_key_pem: "pem" },
        ]),
      },
    });

    const resultNew = await handleEarlyAccess(depsNew, makeEvent("email=alice%40example.com"));
    const resultExisting = await handleEarlyAccess(depsExisting, makeEvent("email=alice%40example.com"));

    expect(resultNew.statusCode).toBe(200);
    expect(resultExisting.statusCode).toBe(200);
    expect(resultNew.body).toBe(resultExisting.body);
  });

  it("ignores revoked licenses (treats user as new)", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        getByEmailHash: vi.fn().mockResolvedValue([
          { license_id: "LIT-2025-REVOKED", status: "revoked", license_key_pem: "pem" },
        ]),
      },
    });

    await handleEarlyAccess(deps, makeEvent("email=alice%40example.com"));

    expect(deps.generateLicenseKey).toHaveBeenCalled();
    expect(deps.db.createLicense).toHaveBeenCalled();
  });
});

describe("handleEarlyAccess — IdempotencyError", () => {
  it("on IdempotencyError, fetches via getBySessionId and re-sends", async () => {
    const existingRecord = {
      license_id: "LIT-2025-EXISTING",
      email_hash: "hashed_email",
      stripe_session_id: "early-access:hashed_email",
      stripe_charge_id: "",
      status: "active" as const,
      license_key_pem: "-----BEGIN LICENSE KEY-----\nexisting\n-----END LICENSE KEY-----",
      issued_at: 500,
      updated_at: 500,
    };
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        createLicense: vi.fn().mockRejectedValue(new IdempotencyError()),
        getBySessionId: vi.fn().mockResolvedValue(existingRecord),
      },
    });

    const result = await handleEarlyAccess(deps, makeEvent("email=alice%40example.com"));

    expect(deps.db.getBySessionId).toHaveBeenCalledWith("early-access:hashed_email");
    expect(deps.email.sendEarlyAdopterEmail).toHaveBeenCalledWith(
      "alice@example.com",
      existingRecord.license_key_pem,
    );
    expect(result.statusCode).toBe(200);
  });

  it("on IdempotencyError when getBySessionId returns null, still returns 200", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        createLicense: vi.fn().mockRejectedValue(new IdempotencyError()),
        getBySessionId: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await handleEarlyAccess(deps, makeEvent("email=alice%40example.com"));

    expect(result.statusCode).toBe(200);
  });

  it("propagates non-IdempotencyError from createLicense", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        createLicense: vi.fn().mockRejectedValue(new Error("DynamoDB timeout")),
      },
    });

    await expect(
      handleEarlyAccess(deps, makeEvent("email=alice%40example.com")),
    ).rejects.toThrow("DynamoDB timeout");
  });
});

describe("handleEarlyAccess — response identity", () => {
  it("consecutive calls return distinct response objects", async () => {
    const deps = makeDeps();
    const result1 = await handleEarlyAccess(deps, makeEvent("email=alice%40example.com"));
    const result2 = await handleEarlyAccess(deps, makeEvent("email=bob%40example.com"));

    expect(result1).not.toBe(result2);
  });
});
