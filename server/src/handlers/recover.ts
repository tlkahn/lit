import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { HandlerDeps } from "../types.js";

export async function handleRecover(
  deps: HandlerDeps,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  let parsed: Record<string, unknown>;
  try {
    parsed = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, body: "Invalid JSON body" };
  }

  const email = parsed.email;
  if (typeof email !== "string" || !email) {
    return { statusCode: 400, body: "Missing email" };
  }

  const emailHash = deps.computeEmailHash(email);
  const records = await deps.db.getByEmailHash(emailHash);

  const active = records.find((r) => r.status === "active");
  if (active) {
    await deps.email.sendRecoveryEmail(email, "Customer", active.license_key_pem);
  }

  return { statusCode: 200, body: JSON.stringify({ message: "If a license exists, a recovery email has been sent." }) };
}
