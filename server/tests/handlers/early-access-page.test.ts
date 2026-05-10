import { describe, it, expect, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { HandlerDeps } from "../../src/types.js";
import { handleEarlyAccessPage } from "../../src/handlers/early-access-page.js";

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
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

function makeEvent(): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/early-access",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

describe("handleEarlyAccessPage", () => {
  it("returns 200 with form HTML when before deadline", async () => {
    const deps = makeDeps();
    const result = await handleEarlyAccessPage(deps, makeEvent());

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain("<form");
    expect(result.body).toContain("Early Access");
  });

  it("returns 200 with closed HTML when past deadline", async () => {
    const deps = makeDeps({
      clock: {
        nowEpochSeconds: vi.fn().mockReturnValue(2000000001),
        isOlderThan: vi.fn(),
      },
    });

    const result = await handleEarlyAccessPage(deps, makeEvent());

    expect(result.statusCode).toBe(200);
    expect(result.body.toLowerCase()).toMatch(/closed|ended/);
  });

  it("returns Content-Type text/html header", async () => {
    const deps = makeDeps();
    const result = await handleEarlyAccessPage(deps, makeEvent());

    expect(result.headers?.["Content-Type"]).toBe("text/html");
  });
});
