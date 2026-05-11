import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@aws-sdk/client-ssm", () => ({ SSMClient: vi.fn() }));
vi.mock("@aws-sdk/client-ses", () => ({ SESClient: vi.fn() }));
vi.mock("stripe", () => {
  const MockStripe = vi.fn(() => ({
    checkout: { sessions: { retrieve: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
  }));
  return { default: MockStripe };
});
vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    tableName: "t",
    privateKey: new Uint8Array(32),
    stripeSecretKey: "sk_test",
    webhookSecret: "whsec_test",
    baseUrl: "https://example.com",
    sesFromEmail: "noreply@example.com",
    stripePriceId: "price_test",
    earlyAccessDeadline: 2000000000,
  }),
}));
vi.mock("../src/db/client.js", () => ({ createDocClient: vi.fn() }));
vi.mock("../src/db/licenses.js", () => ({
  createDbOps: vi.fn(() => ({
    createLicense: vi.fn(),
    getBySessionId: vi.fn(),
    getByChargeId: vi.fn(),
    getByLicenseId: vi.fn(),
    getByEmailHash: vi.fn(),
    revokeLicense: vi.fn(),
  })),
}));
vi.mock("../src/email/send.js", () => ({
  createEmailOps: vi.fn(() => ({
    sendLicenseEmail: vi.fn(),
    sendRecoveryEmail: vi.fn(),
    sendEarlyAdopterEmail: vi.fn(),
  })),
}));
vi.mock("../src/stripe/checkout.js", () => ({ createCheckoutSession: vi.fn() }));
vi.mock("../src/lib/license-key.js", () => ({ generateLicenseKey: vi.fn() }));
vi.mock("../src/lib/license-id.js", () => ({ generateLicenseId: vi.fn() }));
vi.mock("../src/lib/email-hash.js", () => ({ computeEmailHash: vi.fn() }));
vi.mock("../src/lib/time.js", () => ({
  nowEpochSeconds: vi.fn(),
  isOlderThan: vi.fn(),
}));

import { createDeps, resetDepsCache, getStripeClient } from "../src/deps.js";

describe("deps", () => {
  beforeEach(() => {
    resetDepsCache();
  });

  it("resetDepsCache is exported as a function", () => {
    expect(typeof resetDepsCache).toBe("function");
  });

  it("createDeps caches — second call returns same object", async () => {
    const first = await createDeps();
    const second = await createDeps();
    expect(second).toBe(first);
  });

  it("resetDepsCache clears cache — next createDeps returns new object", async () => {
    const first = await createDeps();
    resetDepsCache();
    const second = await createDeps();
    expect(second).not.toBe(first);
  });

  it("getStripeClient returns the Stripe instance after createDeps", async () => {
    await createDeps();
    const client = getStripeClient();
    expect(client).toBeDefined();
    expect(client.checkout).toBeDefined();
  });

  it("getStripeClient throws if called before createDeps", () => {
    expect(() => getStripeClient()).toThrow("createDeps() must be called before getStripeClient()");
  });

  it("getStripeClient returns same instance across calls", async () => {
    await createDeps();
    const first = getStripeClient();
    const second = getStripeClient();
    expect(second).toBe(first);
  });

  it("resetDepsCache clears stripe client", async () => {
    await createDeps();
    resetDepsCache();
    expect(() => getStripeClient()).toThrow();
  });
});
