export interface LicensePayload {
  license_id: string;
  name: string;
  email: string;
  issued_at: number;
  type: string;
}

export type LicenseStatus = "active" | "revoked";

export interface LicenseRecord {
  license_id: string;
  email_hash: string;
  stripe_session_id: string;
  stripe_charge_id: string;
  status: LicenseStatus;
  revoked_at?: number;
  revoked_reason?: string;
  license_key_pem: string;
  email_sent_at?: number;
  issued_at: number;
  updated_at: number;
}

export interface DbOps {
  createLicense(record: LicenseRecord): Promise<LicenseRecord>;
  getBySessionId(sessionId: string): Promise<LicenseRecord | null>;
  getByChargeId(chargeId: string): Promise<LicenseRecord | null>;
  getByLicenseId(licenseId: string): Promise<LicenseRecord | null>;
  getByEmailHash(emailHash: string): Promise<LicenseRecord[]>;
  revokeLicense(
    licenseId: string,
    reason: string,
  ): Promise<void>;
}

export interface StripeOps {
  sessions: {
    retrieve(
      sessionId: string,
    ): Promise<{
      id: string;
      payment_status: string;
      customer_email: string | null;
      customer_details?: { name?: string | null; email?: string | null };
      created: number;
      payment_intent?:
        | string
        | { id: string; latest_charge?: string | { id: string } | null }
        | null;
    }>;
  };
  checkout: {
    create(params: CheckoutParams): Promise<CheckoutResult>;
  };
}

export interface EmailOps {
  sendLicenseEmail(
    to: string,
    name: string,
    pem: string,
  ): Promise<void>;
  sendRecoveryEmail(
    to: string,
    pem: string,
  ): Promise<void>;
}

export interface Config {
  tableName: string;
  privateKey: Uint8Array;
  stripeSecretKey: string;
  webhookSecret: string;
  baseUrl: string;
  sesFromEmail: string;
  stripePriceId: string;
}

export interface Clock {
  nowEpochSeconds(): number;
  isOlderThan(ts: number, maxAgeSecs: number): boolean;
}

// --- Checkout ---
export interface CheckoutParams {
  priceId: string;
  baseUrl: string;
  customerEmail?: string;
}

export interface CheckoutResult {
  url: string;
  id: string;
}

// --- Webhook ---
export type ParsedWebhookEvent =
  | { type: "checkout.session.completed"; sessionId: string }
  | { type: "charge.refunded"; chargeId: string }
  | { type: "charge.dispute.created"; chargeId: string }
  | { type: null };

export interface HandlerDeps {
  db: DbOps;
  stripe: StripeOps;
  email: EmailOps;
  config: Config;
  clock: Clock;
  generateLicenseKey(payload: LicensePayload, privateKey: Uint8Array): string;
  generateLicenseId(yearOverride?: number): string;
  computeEmailHash(email: string): string;
}
