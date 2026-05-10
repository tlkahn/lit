import { describe, it, expect } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { handleRefundPage, handler } from "../../src/handlers/refund-page.js";

function makeEvent(): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/refund",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

describe("handleRefundPage", () => {
  it("returns 200 with refund policy HTML", async () => {
    const result = await handleRefundPage(makeEvent());

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain("Refund Policy");
    expect(result.body).toContain("14");
  });

  it("returns Content-Type text/html header", async () => {
    const result = await handleRefundPage(makeEvent());

    expect(result.headers?.["Content-Type"]).toBe("text/html");
  });

  it("exports handler for Lambda runtime", () => {
    expect(handler).toBe(handleRefundPage);
  });
});
