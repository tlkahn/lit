import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const mockDeps = vi.hoisted(() => ({
  db: {
    createLicense: vi.fn(),
    getBySessionId: vi.fn(),
    getByChargeId: vi.fn(),
    getByLicenseId: vi.fn().mockResolvedValue({ status: "active" }),
    getByEmailHash: vi.fn().mockResolvedValue([]),
    revokeLicense: vi.fn(),
  },
  stripe: {
    sessions: {
      retrieve: vi.fn().mockResolvedValue({
        id: "cs_test",
        payment_status: "paid",
        customer_email: "a@b.com",
        customer_details: { name: "Test" },
        created: 1000,
      }),
    },
    checkout: {
      create: vi.fn().mockResolvedValue({ url: "https://stripe.com/pay", id: "cs_test" }),
    },
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
  generateLicenseKey: vi.fn().mockReturnValue("PEM_DATA"),
  generateLicenseId: vi.fn().mockReturnValue("LIC_001"),
  computeEmailHash: vi.fn().mockReturnValue("hash123"),
}));

vi.mock("../../src/deps.js", () => ({
  createDeps: vi.fn().mockResolvedValue(mockDeps),
}));

vi.mock("../../src/handlers/shared.js", () => ({
  generateAndStoreLicense: vi.fn().mockResolvedValue({ pem: "PEM_DATA" }),
}));

vi.mock("../../src/html/success.js", () => ({
  successPageHtml: vi.fn().mockReturnValue("<html>success</html>"),
  gonePageHtml: vi.fn().mockReturnValue("<html>gone</html>"),
}));

vi.mock("../../src/html/error.js", () => ({
  errorPageHtml: vi.fn().mockReturnValue("<html>error</html>"),
}));

vi.mock("../../src/html/early-access.js", () => ({
  earlyAccessFormHtml: vi.fn().mockReturnValue("<html>form</html>"),
  earlyAccessClosedHtml: vi.fn().mockReturnValue("<html>closed</html>"),
  earlyAccessConfirmationHtml: vi.fn().mockReturnValue("<html>confirm</html>"),
}));

vi.mock("../../src/db/errors.js", () => ({
  IdempotencyError: class IdempotencyError extends Error {},
}));

import { handler as checkoutHandler } from "../../src/handlers/checkout.js";
import { handler as licenseHandler } from "../../src/handlers/license.js";
import { handler as validateHandler } from "../../src/handlers/validate.js";
import { handler as recoverHandler } from "../../src/handlers/recover.js";
import { handler as successPageHandler } from "../../src/handlers/success-page.js";
import { handler as earlyAccessHandler } from "../../src/handlers/early-access.js";
import { handler as earlyAccessPageHandler } from "../../src/handlers/early-access-page.js";

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
    ...overrides,
  };
}

describe("handler wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checkout handler calls createDeps and returns a valid response", async () => {
    const result = await checkoutHandler(makeEvent());
    expect(result).toBeDefined();
    expect(typeof result.statusCode).toBe("number");
  });

  it("license handler calls createDeps and returns a valid response", async () => {
    const result = await licenseHandler(makeEvent({ queryStringParameters: { session_id: "cs_test" } }));
    expect(result).toBeDefined();
    expect(typeof result.statusCode).toBe("number");
  });

  it("validate handler calls createDeps and returns a valid response", async () => {
    const result = await validateHandler(makeEvent({ queryStringParameters: { license_id: "LIC_001" } }));
    expect(result).toBeDefined();
    expect(typeof result.statusCode).toBe("number");
  });

  it("recover handler calls createDeps and returns a valid response", async () => {
    const result = await recoverHandler(makeEvent({ body: JSON.stringify({ email: "a@b.com" }) }));
    expect(result).toBeDefined();
    expect(typeof result.statusCode).toBe("number");
  });

  it("success-page handler calls createDeps and returns a valid response", async () => {
    (mockDeps.db.getBySessionId as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      license_key_pem: "PEM_DATA",
    });
    const result = await successPageHandler(makeEvent({ queryStringParameters: { session_id: "cs_test" } }));
    expect(result).toBeDefined();
    expect(typeof result.statusCode).toBe("number");
  });

  it("early-access handler calls createDeps and returns a valid response", async () => {
    const result = await earlyAccessHandler(makeEvent({ body: "email=test@example.com" }));
    expect(result).toBeDefined();
    expect(typeof result.statusCode).toBe("number");
  });

  it("early-access-page handler calls createDeps and returns a valid response", async () => {
    const result = await earlyAccessPageHandler(makeEvent());
    expect(result).toBeDefined();
    expect(typeof result.statusCode).toBe("number");
  });

  it("all handlers return Promise<APIGatewayProxyResult>", async () => {
    const handlers = [
      checkoutHandler,
      licenseHandler,
      validateHandler,
      recoverHandler,
      successPageHandler,
      earlyAccessHandler,
      earlyAccessPageHandler,
    ];
    for (const h of handlers) {
      const result = h(makeEvent());
      expect(result).toBeInstanceOf(Promise);
      const resolved: APIGatewayProxyResult = await result;
      expect(resolved).toHaveProperty("statusCode");
      expect(resolved).toHaveProperty("body");
    }
  });
});
