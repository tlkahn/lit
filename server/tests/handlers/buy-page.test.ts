import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { handleBuyPage, handler } from "../../src/handlers/buy-page.js";

function makeEvent(): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/buy",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

describe("handleBuyPage", () => {
  let savedSiteKey: string | undefined;

  beforeEach(() => {
    savedSiteKey = process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SITE_KEY;
  });

  afterEach(() => {
    if (savedSiteKey === undefined) delete process.env.TURNSTILE_SITE_KEY;
    else process.env.TURNSTILE_SITE_KEY = savedSiteKey;
  });

  it("returns 200 with buy page HTML", async () => {
    const result = await handleBuyPage(makeEvent());

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain("Lit");
    expect(result.body).toContain("form");
  });

  it("returns Content-Type text/html header", async () => {
    const result = await handleBuyPage(makeEvent());

    expect(result.headers?.["Content-Type"]).toBe("text/html");
  });

  it("exports handler for Lambda runtime", () => {
    expect(handler).toBe(handleBuyPage);
  });

  it("includes Turnstile widget when TURNSTILE_SITE_KEY is set", async () => {
    process.env.TURNSTILE_SITE_KEY = "0x_site_test";

    const result = await handleBuyPage(makeEvent());

    expect(result.body).toContain("cf-turnstile");
    expect(result.body).toContain("0x_site_test");
  });

  it("omits Turnstile widget when TURNSTILE_SITE_KEY is not set", async () => {
    const result = await handleBuyPage(makeEvent());

    expect(result.body).not.toContain("cf-turnstile");
  });
});
