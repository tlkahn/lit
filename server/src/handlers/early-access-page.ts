import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { HandlerDeps } from "../types.js";
import { earlyAccessFormHtml, earlyAccessClosedHtml } from "../html/early-access.js";

export async function handleEarlyAccessPage(
  deps: HandlerDeps,
  _event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const now = deps.clock.nowEpochSeconds();
  const html = now >= deps.config.earlyAccessDeadline
    ? earlyAccessClosedHtml()
    : earlyAccessFormHtml();

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: html,
  };
}
