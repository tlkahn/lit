import type { HandlerDeps, LicenseRecord } from "../types.js";
import { IdempotencyError } from "../db/errors.js";

interface StripeSession {
  id: string;
  customer_email: string | null;
  customer_details?: { name?: string | null; email?: string | null };
  payment_intent?:
    | string
    | { id: string; latest_charge?: string | { id: string } | null }
    | null;
}

function extractChargeId(
  paymentIntent: StripeSession["payment_intent"],
): string {
  if (!paymentIntent || typeof paymentIntent === "string") return "";
  const charge = paymentIntent.latest_charge;
  if (!charge) return "";
  return typeof charge === "string" ? charge : charge.id;
}

export async function generateAndStoreLicense(
  session: StripeSession,
  deps: HandlerDeps,
): Promise<{ licenseRecord: LicenseRecord; pem: string }> {
  const licenseId = deps.generateLicenseId();
  const email = session.customer_details?.email ?? session.customer_email ?? "";
  const name = session.customer_details?.name ?? "Customer";
  const now = deps.clock.nowEpochSeconds();

  const chargeId = extractChargeId(session.payment_intent);

  const payload = {
    license_id: licenseId,
    name,
    email,
    issued_at: now,
    type: "personal",
  };

  const pem = deps.generateLicenseKey(payload, deps.config.privateKey);

  const record: LicenseRecord = {
    license_id: licenseId,
    email_hash: deps.computeEmailHash(email),
    stripe_session_id: session.id,
    stripe_charge_id: chargeId,
    status: "active",
    license_key_pem: pem,
    issued_at: now,
    updated_at: now,
  };

  let licenseRecord: LicenseRecord;
  try {
    licenseRecord = await deps.db.createLicense(record);
  } catch (err) {
    if (err instanceof IdempotencyError) {
      const existing = await deps.db.getBySessionId(session.id);
      return { licenseRecord: existing!, pem: existing!.license_key_pem };
    }
    throw err;
  }

  await deps.email.sendLicenseEmail(email, name, pem);
  return { licenseRecord, pem };
}
