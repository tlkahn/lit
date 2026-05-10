import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAndCompleteCheckout } from "./helpers/stripe-programmatic.js";
import { waitFor } from "./helpers/wait-for.js";
import Stripe from "stripe";

const BASE_URL = process.env.STAGING_BASE_URL!;
const STRIPE_KEY = process.env.STRIPE_TEST_SECRET_KEY!;
const EXPIRED_SESSION_ID = process.env.EXPIRED_SESSION_ID;
const TEST_EMAIL = `smoke-${Date.now()}@lit.solar`;

let sessionId: string;
let paymentIntentId: string;
let licensePem: string;
let licenseId: string;

beforeAll(() => {
  if (!BASE_URL || !STRIPE_KEY) {
    throw new Error(
      "Missing STAGING_BASE_URL or STRIPE_TEST_SECRET_KEY — copy .env.staging.example to .env.staging",
    );
  }
});

// ── I.2.1 — Checkout Redirect ──────────────────────────────────────

describe("I.2.1 — Checkout Redirect", () => {
  it("cycle 1: POST /api/checkout returns 303 to Stripe", async () => {
    const response = await fetch(`${BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL }),
      redirect: "manual",
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("checkout.stripe.com");
  });

  it("cycle 2: POST with empty body still returns 303", async () => {
    const response = await fetch(`${BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      redirect: "manual",
    });

    expect(response.status).toBe(303);
  });
});

// ── I.2.2 — Programmatic Purchase + License Retrieval ──────────────

describe("I.2.2 — Purchase + License", () => {
  it("cycle 1: programmatic checkout returns sessionId", async () => {
    const result = await createAndCompleteCheckout(STRIPE_KEY, BASE_URL, TEST_EMAIL);
    sessionId = result.sessionId;
    paymentIntentId = result.paymentIntentId;

    expect(sessionId).toMatch(/^cs_test_/);
  });

  it("cycle 2: GET /api/license returns 200 with license_key_pem", async () => {
    const response = await fetch(`${BASE_URL}/api/license?session_id=${sessionId}`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.license_key_pem).toBeDefined();

    licensePem = body.license_key_pem;
  });

  it("cycle 3: PEM has correct envelope markers", () => {
    expect(licensePem).toContain("-----BEGIN LICENSE KEY-----");
    expect(licensePem).toContain("-----END LICENSE KEY-----");
  });

  it("cycle 4: decoded payload has required fields", () => {
    const inner = licensePem
      .replace("-----BEGIN LICENSE KEY-----", "")
      .replace("-----END LICENSE KEY-----", "")
      .trim();
    const payloadB64 = inner.slice(0, inner.lastIndexOf("."));
    const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf-8"));

    expect(payload.license_id).toBeDefined();
    expect(payload.name).toBeDefined();
    expect(payload.email).toBeDefined();
    expect(payload.issued_at).toEqual(expect.any(Number));
    expect(payload.type).toBeDefined();

    licenseId = payload.license_id;
  });

  it("cycle 5: second GET returns identical PEM (idempotent)", async () => {
    const response = await fetch(`${BASE_URL}/api/license?session_id=${sessionId}`);
    const body = await response.json();

    expect(body.license_key_pem).toBe(licensePem);
  });
});

// ── I.2.3 — Success Page ───────────────────────────────────────────

describe("I.2.3 — Success Page", () => {
  it("cycle 1: success page returns 200 HTML with PEM", async () => {
    const response = await fetch(`${BASE_URL}/purchase/success?session_id=${sessionId}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const body = await response.text();
    expect(body).toContain("BEGIN LICENSE KEY");
  });

  it("cycle 2: success page contains deep link", async () => {
    const response = await fetch(`${BASE_URL}/purchase/success?session_id=${sessionId}`);
    const body = await response.text();

    expect(body).toContain("lit://activate?key=");
  });
});

// ── I.2.4 — Validate (Active) ─────────────────────────────────────

describe("I.2.4 — Validate", () => {
  it("cycle 1: validate active license returns valid", async () => {
    const response = await fetch(`${BASE_URL}/api/validate?license_id=${licenseId}`);
    const body = await response.json();

    expect(body).toEqual({ status: "valid" });
  });

  it("cycle 2: validate nonexistent ID also returns valid (anti-enumeration)", async () => {
    const response = await fetch(`${BASE_URL}/api/validate?license_id=LIT-9999-NONEXISTENT`);
    const body = await response.json();

    expect(body).toEqual({ status: "valid" });
  });
});

// ── I.2.5 — Webhook: Refund Revocation ─────────────────────────────

describe("I.2.5 — Refund Revocation", () => {
  it("cycle 1: create refund via Stripe SDK", async () => {
    const stripe = new Stripe(STRIPE_KEY);
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
    });

    expect(refund.status).toBe("succeeded");
  });

  it("cycle 2: validate eventually returns revoked", async () => {
    const result = await waitFor(
      async () => {
        const response = await fetch(`${BASE_URL}/api/validate?license_id=${licenseId}`);
        return response.json() as Promise<{ status: string; reason?: string }>;
      },
      {
        until: (body) => body.status === "revoked",
        timeout: 15_000,
        interval: 2_000,
      },
    );

    expect(result).toEqual({ status: "revoked", reason: "refund" });
  });
});

// ── I.2.6 — Recovery ──────────────────────────────────────────────

describe("I.2.6 — Recovery", () => {
  it("cycle 1: recover with known email returns 200 generic message", async () => {
    const response = await fetch(`${BASE_URL}/api/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBeDefined();
  });

  it("cycle 2: recover with unknown email returns identical 200", async () => {
    const response = await fetch(`${BASE_URL}/api/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nonexistent@lit.solar" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBeDefined();
  });
});

// ── I.2.7 — Session Expiry (410) ──────────────────────────────────

describe("I.2.7 — Session Expiry", () => {
  it.skipIf(!EXPIRED_SESSION_ID)("cycle 1: expired session returns 410 on /api/license", async () => {
    const response = await fetch(`${BASE_URL}/api/license?session_id=${EXPIRED_SESSION_ID!}`);
    expect(response.status).toBe(410);
  });

  it.skipIf(!EXPIRED_SESSION_ID)("cycle 2: expired session returns 410 HTML on /purchase/success", async () => {
    const response = await fetch(`${BASE_URL}/purchase/success?session_id=${EXPIRED_SESSION_ID!}`);
    expect(response.status).toBe(410);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});

// ── I.2.8 — Cleanup/Teardown ──────────────────────────────────────

afterAll(() => {
  console.log(`\n  Staging smoke test artifacts:`);
  console.log(`    session_id: ${sessionId}`);
  console.log(`    license_id: ${licenseId}`);
  console.log(`    payment_intent: ${paymentIntentId}`);
  console.log(`    email: ${TEST_EMAIL}\n`);
});
