import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { privacyPageHtml } from "../html/privacy.js";

export async function handlePrivacyPage(
  _event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: privacyPageHtml(),
  };
}

export const handler = handlePrivacyPage;
