import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { HandlerDeps } from "../types.js";
import { IdempotencyError } from "../db/errors.js";
import { trialConfirmationHtml } from "../html/trial.js";
import { validateTurnstile } from "../lib/turnstile.js";
import { createDeps } from "../deps.js";

const SEVEN_DAYS = 7 * 24 * 60 * 60;

function formatExpiryDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

export async function handleTrial(
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

  const turnstileToken = params.get("cf-turnstile-response");
  if (deps.config.turnstileSecret) {
    if (!turnstileToken) {
      return { statusCode: 403, body: "Bot verification required" };
    }
    const valid = await validateTurnstile(deps.config.turnstileSecret, turnstileToken);
    if (!valid) {
      return { statusCode: 403, body: "Bot verification failed" };
    }
  }

  const now = deps.clock.nowEpochSeconds();
  const expiresAt = now + SEVEN_DAYS;
  const expiryDate = formatExpiryDate(expiresAt);
  const emailHash = deps.computeEmailHash(email);

  const records = await deps.db.getByEmailHash(emailHash);
  const active = records.find((r) => r.status === "active");
  if (active) {
    await deps.email.sendTrialEmail(email, active.license_key_pem, expiryDate);
    return { statusCode: 200, headers: { "Content-Type": "text/html" }, body: trialConfirmationHtml() };
  }

  const licenseId = deps.generateLicenseId();
  const payload = {
    license_id: licenseId,
    name: "Customer",
    email,
    issued_at: now,
    type: "trial",
    expires_at: expiresAt,
  };
  const pem = deps.generateLicenseKey(payload, deps.config.privateKey);
  const sessionId = `trial:${emailHash}`;

  const record = {
    license_id: licenseId,
    email_hash: emailHash,
    stripe_session_id: sessionId,
    status: "active" as const,
    license_key_pem: pem,
    issued_at: now,
    updated_at: now,
  };

  try {
    await deps.db.createLicense(record);
    await deps.email.sendTrialEmail(email, pem, expiryDate);
  } catch (err) {
    if (err instanceof IdempotencyError) {
      const existing = await deps.db.getBySessionId(sessionId);
      if (existing) {
        await deps.email.sendTrialEmail(email, existing.license_key_pem, expiryDate);
      }
      return { statusCode: 200, headers: { "Content-Type": "text/html" }, body: trialConfirmationHtml() };
    }
    throw err;
  }

  return { statusCode: 200, headers: { "Content-Type": "text/html" }, body: trialConfirmationHtml() };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const deps = await createDeps();
  return handleTrial(deps, event);
};
