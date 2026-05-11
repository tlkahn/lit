import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";

const mockStripeClient = vi.hoisted(() => ({
  checkout: { sessions: { retrieve: vi.fn() } },
  webhooks: { constructEvent: vi.fn() },
}));

const mockDeps = vi.hoisted(() => ({
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
    checkout: { create: vi.fn() },
  },
  email: {
    sendLicenseEmail: vi.fn(),
    sendRecoveryEmail: vi.fn(),
    sendEarlyAdopterEmail: vi.fn(),
  },
  config: {
    tableName: "t",
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
}));

vi.mock("../../src/deps.js", () => ({
  createDeps: vi.fn().mockResolvedValue(mockDeps),
  getStripeClient: vi.fn().mockReturnValue(mockStripeClient),
}));

vi.mock("../../src/stripe/webhook.js", () => ({
  verifyWebhookEvent: vi.fn().mockReturnValue({
    type: "checkout.session.completed",
    data: { object: { id: "cs_test" } },
  }),
  parseWebhookEvent: vi.fn().mockReturnValue({ type: null }),
}));

vi.mock("../../src/handlers/shared.js", () => ({
  generateAndStoreLicense: vi.fn(),
}));

import { handler } from "../../src/handlers/webhook.js";
import { getStripeClient } from "../../src/deps.js";

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: '{"id":"evt_test"}',
    headers: { "stripe-signature": "sig_test" },
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
    ...overrides,
  };
}

describe("webhook handler wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handler calls createDeps and delegates to handleWebhook", async () => {
    const result = await handler(makeEvent());
    expect(result).toBeDefined();
    expect(typeof result.statusCode).toBe("number");
  });

  it("handler uses getStripeClient instead of constructing a new Stripe instance", async () => {
    await handler(makeEvent());
    expect(getStripeClient).toHaveBeenCalled();
  });

  it("handler returns Promise<APIGatewayProxyResult>", async () => {
    const result = handler(makeEvent());
    expect(result).toBeInstanceOf(Promise);
    const resolved = await result;
    expect(resolved).toHaveProperty("statusCode");
    expect(resolved).toHaveProperty("body");
  });
});
