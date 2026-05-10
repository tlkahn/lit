import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { HandlerDeps } from "../types.js";
import { IdempotencyError } from "../db/errors.js";
import { earlyAccessConfirmationHtml, earlyAccessClosedHtml } from "../html/early-access.js";

export async function handleEarlyAccess(
  deps: HandlerDeps,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return { statusCode: 400, body: "Missing body" };
  }

  const params = new URLSearchParams(event.body);
  const email = params.get("email");
  if (!email) {
    return { statusCode: 400, body: "Missing email" };
  }
  if (!email.includes("@")) {
    return { statusCode: 400, body: "Invalid email" };
  }

  const now = deps.clock.nowEpochSeconds();
  if (now >= deps.config.earlyAccessDeadline) {
    return {
      statusCode: 410,
      headers: { "Content-Type": "text/html" },
      body: earlyAccessClosedHtml(),
    };
  }

  const emailHash = deps.computeEmailHash(email);

  const records = await deps.db.getByEmailHash(emailHash);
  const active = records.find((r) => r.status === "active");
  if (active) {
    await deps.email.sendEarlyAdopterEmail(email, active.license_key_pem);
    return { statusCode: 200, headers: { "Content-Type": "text/html" }, body: earlyAccessConfirmationHtml() };
  }

  const licenseId = deps.generateLicenseId();
  const payload = {
    license_id: licenseId,
    name: "Customer",
    email,
    issued_at: now,
    type: "early_adopter",
  };
  const pem = deps.generateLicenseKey(payload, deps.config.privateKey);
  const sessionId = `early-access:${emailHash}`;

  const record = {
    license_id: licenseId,
    email_hash: emailHash,
    stripe_session_id: sessionId,
    stripe_charge_id: "",
    status: "active" as const,
    license_key_pem: pem,
    issued_at: now,
    updated_at: now,
  };

  try {
    await deps.db.createLicense(record);
    await deps.email.sendEarlyAdopterEmail(email, pem);
  } catch (err) {
    if (err instanceof IdempotencyError) {
      const existing = await deps.db.getBySessionId(sessionId);
      if (existing) {
        await deps.email.sendEarlyAdopterEmail(email, existing.license_key_pem);
      }
      return { statusCode: 200, headers: { "Content-Type": "text/html" }, body: earlyAccessConfirmationHtml() };
    }
    throw err;
  }

  return { statusCode: 200, headers: { "Content-Type": "text/html" }, body: earlyAccessConfirmationHtml() };
}
