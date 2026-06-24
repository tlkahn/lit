import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { trialFormHtml } from "../html/trial.js";

export async function handleTrialPage(
  _event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const siteKey = process.env.TURNSTILE_SITE_KEY || undefined;
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: trialFormHtml(siteKey),
  };
}

export const handler = handleTrialPage;
