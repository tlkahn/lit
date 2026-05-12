import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { buyPageHtml } from "../html/buy.js";

export async function handleBuyPage(
  _event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const siteKey = process.env.TURNSTILE_SITE_KEY || undefined;
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: buyPageHtml(siteKey),
  };
}

export const handler = handleBuyPage;
