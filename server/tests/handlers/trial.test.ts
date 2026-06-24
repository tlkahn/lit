import { describe, it, expect, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { HandlerDeps } from "../../src/types.js";
import { IdempotencyError } from "../../src/db/errors.js";

vi.mock("../../src/lib/turnstile.js", () => ({
  validateTurnstile: vi.fn().mockResolvedValue(true),
}));

import { handleTrial } from "../../src/handlers/trial.js";
import { validateTurnstile } from "../../src/lib/turnstile.js";

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
      sendEarlyAdopterEmail: vi.fn(),
      sendTrialEmail: vi.fn().mockResolvedValue(undefined),
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
    path: "/api/trial",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

describe("handleTrial — validation", () => {
  it("returns 400 when body is missing", async () => {
    const deps = makeDeps();
    const result = await handleTrial(deps, makeEvent());
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 when email field is missing", async () => {
    const deps = makeDeps();
    const result = await handleTrial(deps, makeEvent("name=Alice"));
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 when email is empty", async () => {
    const deps = makeDeps();
    const result = await handleTrial(deps, makeEvent("email="));
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 when email has no @", async () => {
    const deps = makeDeps();
    const result = await handleTrial(deps, makeEvent("email=notanemail"));
    expect(result.statusCode).toBe(400);
  });
});

describe("handleTrial — Turnstile", () => {
  it("skips Turnstile when turnstileSecret is not configured", async () => {
    const deps = makeDeps();
    vi.mocked(validateTurnstile).mockClear();

    await handleTrial(deps, makeEvent("email=alice%40example.com"));

    expect(validateTurnstile).not.toHaveBeenCalled();
  });

  it("returns 403 when Turnstile is configured but token is missing", async () => {
    const deps = makeDeps({ config: { ...makeDeps().config, turnstileSecret: "tsec_test" } });

    const result = await handleTrial(deps, makeEvent("email=alice%40example.com"));

    expect(result.statusCode).toBe(403);
  });

  it("returns 403 when Turnstile validation fails", async () => {
    const deps = makeDeps({ config: { ...makeDeps().config, turnstileSecret: "tsec_test" } });
    vi.mocked(validateTurnstile).mockResolvedValue(false);

    const result = await handleTrial(deps, makeEvent("email=alice%40example.com&cf-turnstile-response=tok_bad"));

    expect(result.statusCode).toBe(403);
  });

  it("proceeds when Turnstile validation succeeds", async () => {
    const deps = makeDeps({ config: { ...makeDeps().config, turnstileSecret: "tsec_test" } });
    vi.mocked(validateTurnstile).mockResolvedValue(true);

    const result = await handleTrial(deps, makeEvent("email=alice%40example.com&cf-turnstile-response=tok_ok"));

    expect(result.statusCode).toBe(200);
    expect(validateTurnstile).toHaveBeenCalledWith("tsec_test", "tok_ok");
  });
});

describe("handleTrial — happy path", () => {
  it("generates license with type trial and expires_at for new email", async () => {
    const deps = makeDeps();
    await handleTrial(deps, makeEvent("email=alice%40example.com"));

    expect(deps.generateLicenseKey).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "trial",
        expires_at: 1000 + 7 * 24 * 60 * 60,
      }),
      deps.config.privateKey,
    );
  });

  it("stores in DynamoDB with trial sentinel session ID", async () => {
    const deps = makeDeps();
    await handleTrial(deps, makeEvent("email=alice%40example.com"));

    expect(deps.db.createLicense).toHaveBeenCalledWith(
      expect.objectContaining({
        stripe_session_id: "trial:hashed_email",
      }),
    );
  });

  it("sends trial email", async () => {
    const deps = makeDeps();
    await handleTrial(deps, makeEvent("email=alice%40example.com"));

    expect(deps.email.sendTrialEmail).toHaveBeenCalledWith(
      "alice@example.com",
      fakePem,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("returns 200 with confirmation HTML", async () => {
    const deps = makeDeps();
    const result = await handleTrial(deps, makeEvent("email=alice%40example.com"));

    expect(result.statusCode).toBe(200);
    expect(result.headers?.["Content-Type"]).toBe("text/html");
    expect(result.body.toLowerCase()).toContain("check your email");
  });

  it("license payload uses name Customer", async () => {
    const deps = makeDeps();
    await handleTrial(deps, makeEvent("email=alice%40example.com"));

    expect(deps.generateLicenseKey).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Customer" }),
      deps.config.privateKey,
    );
  });
});

describe("handleTrial — email dedup", () => {
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

    await handleTrial(deps, makeEvent("email=alice%40example.com"));

    expect(deps.email.sendTrialEmail).toHaveBeenCalledWith(
      "alice@example.com",
      "-----BEGIN LICENSE KEY-----\nexisting\n-----END LICENSE KEY-----",
      expect.any(String),
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

    await handleTrial(deps, makeEvent("email=alice%40example.com"));

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

    const resultNew = await handleTrial(depsNew, makeEvent("email=alice%40example.com"));
    const resultExisting = await handleTrial(depsExisting, makeEvent("email=alice%40example.com"));

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

    await handleTrial(deps, makeEvent("email=alice%40example.com"));

    expect(deps.generateLicenseKey).toHaveBeenCalled();
    expect(deps.db.createLicense).toHaveBeenCalled();
  });
});

describe("handleTrial — IdempotencyError", () => {
  it("on IdempotencyError, fetches via getBySessionId and re-sends", async () => {
    const existingRecord = {
      license_id: "LIT-2025-EXISTING",
      email_hash: "hashed_email",
      stripe_session_id: "trial:hashed_email",
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

    const result = await handleTrial(deps, makeEvent("email=alice%40example.com"));

    expect(deps.db.getBySessionId).toHaveBeenCalledWith("trial:hashed_email");
    expect(deps.email.sendTrialEmail).toHaveBeenCalledWith(
      "alice@example.com",
      existingRecord.license_key_pem,
      expect.any(String),
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

    const result = await handleTrial(deps, makeEvent("email=alice%40example.com"));

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
      handleTrial(deps, makeEvent("email=alice%40example.com")),
    ).rejects.toThrow("DynamoDB timeout");
  });
});
