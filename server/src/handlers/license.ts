import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { HandlerDeps } from "../types.js";
import { generateAndStoreLicense } from "./shared.js";

export async function handleLicense(
  deps: HandlerDeps,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const sessionId = event.queryStringParameters?.session_id;
  if (!sessionId) {
    return { statusCode: 400, body: "Missing session_id parameter" };
  }

  const session = await deps.stripe.sessions.retrieve(sessionId);

  if (deps.clock.isOlderThan(session.created, 3600)) {
    return { statusCode: 410, body: "Session expired" };
  }

  if (session.payment_status !== "paid") {
    return { statusCode: 402, body: "Payment not completed" };
  }

  const existing = await deps.db.getBySessionId(sessionId);
  if (existing) {
    return {
      statusCode: 200,
      body: JSON.stringify({ license_key_pem: existing.license_key_pem }),
    };
  }

  const { pem } = await generateAndStoreLicense(session, deps);
  return {
    statusCode: 200,
    body: JSON.stringify({ license_key_pem: pem }),
  };
}
