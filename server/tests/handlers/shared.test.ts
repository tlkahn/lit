import { describe, it, expect, vi } from "vitest";
import type { HandlerDeps } from "../../src/types.js";
import { generateAndStoreLicense } from "../../src/handlers/shared.js";
import { IdempotencyError } from "../../src/db/errors.js";

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    db: {
      createLicense: vi.fn().mockImplementation((r) => Promise.resolve(r)),
      getBySessionId: vi.fn(),
      getByChargeId: vi.fn(),
      getByLicenseId: vi.fn(),
      getByEmailHash: vi.fn(),
      revokeLicense: vi.fn(),
    },
    stripe: {
      sessions: { retrieve: vi.fn() },
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
    generateLicenseKey: vi.fn().mockReturnValue("-----BEGIN LICENSE KEY-----\nfake\n-----END LICENSE KEY-----"),
    generateLicenseId: vi.fn().mockReturnValue("LIT-2025-ABCD1234"),
    computeEmailHash: vi.fn().mockReturnValue("abc123hash"),
    ...overrides,
  };
}

const session = {
  id: "cs_test_123",
  payment_status: "paid",
  customer_email: "alice@example.com",
  customer_details: { name: "Alice", email: "alice@example.com" },
  created: 900,
  payment_intent: { id: "pi_123", latest_charge: "ch_456" },
};

describe("generateAndStoreLicense", () => {
  it("generates license ID, builds payload, signs, and stores in DynamoDB", async () => {
    const deps = makeDeps();
    await generateAndStoreLicense(session, deps);

    expect(deps.generateLicenseId).toHaveBeenCalled();
    expect(deps.generateLicenseKey).toHaveBeenCalledWith(
      expect.objectContaining({
        license_id: "LIT-2025-ABCD1234",
        name: "Alice",
        email: "alice@example.com",
        type: "personal",
      }),
      deps.config.privateKey,
    );
    expect(deps.db.createLicense).toHaveBeenCalledWith(
      expect.objectContaining({
        license_id: "LIT-2025-ABCD1234",
        stripe_session_id: "cs_test_123",
        status: "active",
      }),
    );
  });

  it("stores stripe_charge_id from session payment_intent.latest_charge", async () => {
    const deps = makeDeps();
    await generateAndStoreLicense(session, deps);

    expect(deps.db.createLicense).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_charge_id: "ch_456" }),
    );
  });

  it("handles string latest_charge", async () => {
    const deps = makeDeps();
    const sess = {
      ...session,
      payment_intent: { id: "pi_123", latest_charge: "ch_string" },
    };
    await generateAndStoreLicense(sess, deps);

    expect(deps.db.createLicense).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_charge_id: "ch_string" }),
    );
  });

  it("handles expanded object latest_charge", async () => {
    const deps = makeDeps();
    const sess = {
      ...session,
      payment_intent: { id: "pi_123", latest_charge: { id: "ch_expanded" } },
    };
    await generateAndStoreLicense(sess, deps);

    expect(deps.db.createLicense).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_charge_id: "ch_expanded" }),
    );
  });

  it("sends license email via SES", async () => {
    const deps = makeDeps();
    await generateAndStoreLicense(session, deps);

    expect(deps.email.sendLicenseEmail).toHaveBeenCalledWith(
      "alice@example.com",
      "Alice",
      "-----BEGIN LICENSE KEY-----\nfake\n-----END LICENSE KEY-----",
    );
  });

  it("returns licenseRecord and pem", async () => {
    const deps = makeDeps();
    const result = await generateAndStoreLicense(session, deps);

    expect(result.pem).toBe("-----BEGIN LICENSE KEY-----\nfake\n-----END LICENSE KEY-----");
    expect(result.licenseRecord).toEqual(
      expect.objectContaining({
        license_id: "LIT-2025-ABCD1234",
        status: "active",
      }),
    );
  });

  it("on IdempotencyError, fetches existing license via getBySessionId", async () => {
    const existingRecord = {
      license_id: "LIT-2025-EXISTING",
      email_hash: "abc",
      stripe_session_id: "cs_test_123",
      stripe_charge_id: "ch_456",
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

    const result = await generateAndStoreLicense(session, deps);

    expect(deps.db.getBySessionId).toHaveBeenCalledWith("cs_test_123");
    expect(result.licenseRecord).toEqual(existingRecord);
    expect(result.pem).toBe(existingRecord.license_key_pem);
  });

  it("stores email_hash (not raw email) in DB record", async () => {
    const deps = makeDeps();
    await generateAndStoreLicense(session, deps);

    expect(deps.computeEmailHash).toHaveBeenCalledWith("alice@example.com");
    expect(deps.db.createLicense).toHaveBeenCalledWith(
      expect.objectContaining({ email_hash: "abc123hash" }),
    );
  });

  it("on IdempotencyError, throws descriptive error when getBySessionId returns null", async () => {
    const deps = makeDeps({
      db: {
        ...makeDeps().db,
        createLicense: vi.fn().mockRejectedValue(new IdempotencyError()),
        getBySessionId: vi.fn().mockResolvedValue(null),
      },
    });
    await expect(generateAndStoreLicense(session, deps)).rejects.toThrow(/eventual consistency/i);
  });

  it("uses session-scoped sentinel for email hash when email is missing", async () => {
    const deps = makeDeps();
    const noEmailSession = {
      ...session,
      customer_email: null,
      customer_details: { name: "Alice", email: null },
    };
    await generateAndStoreLicense(noEmailSession, deps);
    expect(deps.computeEmailHash).toHaveBeenCalledWith(`no-email:${noEmailSession.id}`);
  });

  it("two email-less sessions produce different email hash inputs", async () => {
    const deps1 = makeDeps();
    const deps2 = makeDeps();
    const sess1 = { ...session, id: "cs_aaa", customer_email: null, customer_details: { name: "A", email: null } };
    const sess2 = { ...session, id: "cs_bbb", customer_email: null, customer_details: { name: "B", email: null } };
    await generateAndStoreLicense(sess1, deps1);
    await generateAndStoreLicense(sess2, deps2);
    const arg1 = (deps1.computeEmailHash as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const arg2 = (deps2.computeEmailHash as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg1).not.toBe(arg2);
  });
});
