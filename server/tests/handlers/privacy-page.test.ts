import { describe, it, expect } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { handlePrivacyPage, handler } from "../../src/handlers/privacy-page.js";

function makeEvent(): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/privacy",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

describe("handlePrivacyPage", () => {
  it("returns 200 with privacy policy HTML", async () => {
    const result = await handlePrivacyPage(makeEvent());

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain("Privacy Policy");
    expect(result.body).toContain("privacy@lit.solar");
  });

  it("returns Content-Type text/html header", async () => {
    const result = await handlePrivacyPage(makeEvent());

    expect(result.headers?.["Content-Type"]).toBe("text/html");
  });

  it("exports handler for Lambda runtime", () => {
    expect(handler).toBe(handlePrivacyPage);
  });
});
