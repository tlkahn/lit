import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { HandlerDeps } from "../types.js";
import { successPageHtml, gonePageHtml } from "../html/success.js";
import { errorPageHtml } from "../html/error.js";
import { createDeps } from "../deps.js";

export async function handleSuccessPage(
  deps: HandlerDeps,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const sessionId = event.queryStringParameters?.session_id;
  if (!sessionId) {
    return { statusCode: 400, body: "Missing session_id parameter" };
  }

  try {
    const session = await deps.stripe.sessions.retrieve(sessionId);

    if (deps.clock.isOlderThan(session.created, 3600)) {
      return {
        statusCode: 410,
        headers: { "Content-Type": "text/html" },
        body: gonePageHtml(),
      };
    }

    const record = await deps.db.getBySessionId(sessionId);
    if (!record) {
      return { statusCode: 404, body: "License not found" };
    }

    const name = session.customer_details?.name ?? "Customer";

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: successPageHtml(record.license_key_pem, name),
    };
  } catch {
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/html" },
      body: errorPageHtml(),
    };
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const deps = await createDeps();
  return handleSuccessPage(deps, event);
};
