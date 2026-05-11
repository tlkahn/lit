/*
 * Sequential e2e lifecycle tests — MUST run in declaration order.
 * Later describe blocks depend on DB state created by earlier ones:
 *   I.1.1 creates cs_test_happy, I.1.2 creates cs_test_idempotent,
 *   I.1.3 reuses cs_test_happy + creates cs_test_webhook_new,
 *   I.1.4 creates cs_test_refund, I.1.5 creates cs_test_dispute,
 *   I.1.6 creates cs_test_recover, I.1.7 reuses cs_test_expiry.
 * Do NOT add .concurrent or sequence.shuffle to this file.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type Stripe from "stripe";
import type { HandlerDeps, ParsedWebhookEvent } from "../../src/types.js";
import { createTestDocClient, createTestTable, deleteTestTable } from "./helpers/dynamo-table.js";
import { createStripeFake } from "./fakes/stripe-fake.js";
import { createSesFake } from "./fakes/ses-fake.js";
import { createClockFake } from "./fakes/clock-fake.js";
import { TEST_PRIVATE_KEY, TEST_PUBLIC_KEY, verifyPem } from "./helpers/test-keypair.js";
import { createDbOps } from "../../src/db/licenses.js";
import { generateLicenseKey } from "../../src/lib/license-key.js";
import { generateLicenseId } from "../../src/lib/license-id.js";
import { computeEmailHash } from "../../src/lib/email-hash.js";
import { getByLicenseId, getBySessionId } from "../../src/db/licenses.js";
import { handleCheckout } from "../../src/handlers/checkout.js";
import { handleLicense } from "../../src/handlers/license.js";
import { handleValidate } from "../../src/handlers/validate.js";
import { handleWebhook } from "../../src/handlers/webhook.js";
import { handleRecover } from "../../src/handlers/recover.js";
import { handleSuccessPage } from "../../src/handlers/success-page.js";
import { parseWebhookEvent } from "../../src/stripe/webhook.js";

const TABLE = `e2e-lifecycle-${Date.now()}`;

let rawClient: DynamoDBClient;
let docClient: DynamoDBDocumentClient;
let stripeFake: ReturnType<typeof createStripeFake>;
let sesFake: ReturnType<typeof createSesFake>;
let clockFake: ReturnType<typeof createClockFake>;
let deps: HandlerDeps;

function buildFakeStripeEvent(parsed: ParsedWebhookEvent): Stripe.Event {
  if (parsed.type === "checkout.session.completed") {
    const obj = parsed.session ?? { id: parsed.sessionId };
    return { type: "checkout.session.completed", data: { object: obj } } as unknown as Stripe.Event;
  }
  if (parsed.type === "charge.refunded")
    return { type: "charge.refunded", data: { object: { id: parsed.chargeId } } } as unknown as Stripe.Event;
  if (parsed.type === "charge.dispute.created")
    return { type: "charge.dispute.created", data: { object: { charge: parsed.chargeId } } } as unknown as Stripe.Event;
  return { type: "unknown", data: { object: {} } } as unknown as Stripe.Event;
}

function makeWebhookEvent(parsed: ParsedWebhookEvent) {
  const stripeEvent = buildFakeStripeEvent(parsed);
  const event = makeEvent({
    httpMethod: "POST",
    headers: { "stripe-signature": "sig_fake" },
    body: "{}",
  });
  return { event, verify: () => stripeEvent, parse: parseWebhookEvent };
}

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
    ...overrides,
  };
}

beforeAll(async () => {
  const clients = createTestDocClient();
  rawClient = clients.rawClient;
  docClient = clients.docClient;
  await createTestTable(rawClient, TABLE);

  stripeFake = createStripeFake();
  sesFake = createSesFake();
  clockFake = createClockFake();

  deps = {
    db: createDbOps(docClient, TABLE),
    stripe: stripeFake,
    email: sesFake,
    config: {
      tableName: TABLE,
      privateKey: TEST_PRIVATE_KEY,
      stripeSecretKey: "sk_test_fake",
      webhookSecret: "whsec_fake",
      baseUrl: "https://test.lit.solar",
      sesFromEmail: "noreply@lit.solar",
      stripePriceId: "price_fake_123",
      earlyAccessDeadline: 2000000000,
    },
    clock: clockFake,
    generateLicenseKey,
    generateLicenseId,
    computeEmailHash,
  };
});

afterAll(async () => {
  await deleteTestTable(rawClient, TABLE);
  rawClient.destroy();
});

// ── I.1.1 — Happy Path: Checkout → License → Validate ──────────────

describe("I.1.1 — Happy Path", () => {
  let pem: string;
  let licenseId: string;
  const SESSION_ID = "cs_test_happy";
  const BUYER_EMAIL = "buyer@test.com";
  const BUYER_NAME = "Jane Buyer";
  const SESSION_CREATED = 1700000000;

  it("cycle 1: handleCheckout returns 303 with Stripe redirect", async () => {
    const event = makeEvent({
      httpMethod: "POST",
      body: JSON.stringify({ email: "buyer@test.com" }),
    });

    const result = await handleCheckout(deps, event);

    expect(result.statusCode).toBe(303);
    expect(result.headers!["Location"]).toBe("https://checkout.stripe.test/cs_fake_123");
    expect(stripeFake.calls).toHaveLength(1);
    expect(stripeFake.calls[0]!.method).toBe("checkout.create");
    expect((stripeFake.calls[0]!.args[0] as Record<string, unknown>).customerEmail).toBe("buyer@test.com");
  });

  it("cycle 2: handleLicense with paid session returns 200 with license_key_pem", async () => {
    stripeFake.setSession({
      id: SESSION_ID,
      payment_status: "paid",
      customer_email: BUYER_EMAIL,
      customer_details: { name: BUYER_NAME, email: BUYER_EMAIL },
      created: SESSION_CREATED,
      payment_intent: { id: "pi_test_1", latest_charge: "ch_test_1" },
    });

    const event = makeEvent({
      queryStringParameters: { session_id: SESSION_ID },
    });

    const result = await handleLicense(deps, event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.license_key_pem).toBeDefined();
    expect(body.license_key_pem).toContain("-----BEGIN LICENSE KEY-----");

    pem = body.license_key_pem;
  });

  it("cycle 3: PEM signature verifies and payload contains correct fields", () => {
    expect(pem).toBeDefined();

    const { valid, payload } = verifyPem(pem, TEST_PUBLIC_KEY);

    expect(valid).toBe(true);
    expect(payload.license_id).toMatch(/^LIT-\d{4}-/);
    expect(payload.name).toBe(BUYER_NAME);
    expect(payload.email).toBe(BUYER_EMAIL);
    expect(payload.type).toBe("personal");
    expect(payload.issued_at).toBe(SESSION_CREATED);

    licenseId = payload.license_id;
  });

  it("cycle 4: DB record is active with email_hash, no raw email stored", async () => {
    expect(licenseId).toBeDefined();

    const record = await getByLicenseId(docClient, TABLE, licenseId);

    expect(record).not.toBeNull();
    expect(record!.status).toBe("active");
    expect(record!.email_hash).toBe(computeEmailHash(BUYER_EMAIL));
    expect((record as unknown as Record<string, unknown>).email).toBeUndefined();
  });

  it("cycle 5: license email was sent exactly once with correct data", () => {
    expect(sesFake.sentEmails).toHaveLength(1);
    expect(sesFake.sentEmails[0]!.type).toBe("license");
    expect(sesFake.sentEmails[0]!.to).toBe(BUYER_EMAIL);
    expect(sesFake.sentEmails[0]!.pem).toBe(pem);
  });

  it("cycle 6: handleValidate returns valid for the new license", async () => {
    expect(licenseId).toBeDefined();

    const event = makeEvent({
      queryStringParameters: { license_id: licenseId },
    });

    const result = await handleValidate(deps, event);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ status: "valid" });
  });
});

// ── I.1.2 — Idempotency: Duplicate License Request ─────────────────

describe("I.1.2 — Idempotency", () => {
  const SESSION_ID = "cs_test_idempotent";
  const SESSION_CREATED = 1700000000;

  it("cycle 1: two handleLicense calls with same session_id return identical PEM", async () => {
    stripeFake.setSession({
      id: SESSION_ID,
      payment_status: "paid",
      customer_email: "idempotent@test.com",
      customer_details: { name: "Repeat Buyer", email: "idempotent@test.com" },
      created: SESSION_CREATED,
      payment_intent: { id: "pi_test_idem", latest_charge: "ch_test_idem" },
    });
    sesFake.reset();

    const event = makeEvent({ queryStringParameters: { session_id: SESSION_ID } });

    const result1 = await handleLicense(deps, event);
    const result2 = await handleLicense(deps, event);

    expect(result1.statusCode).toBe(200);
    expect(result2.statusCode).toBe(200);

    const pem1 = JSON.parse(result1.body).license_key_pem;
    const pem2 = JSON.parse(result2.body).license_key_pem;
    expect(pem1).toBe(pem2);
  });

  it("cycle 2: only one DB record exists for the session", async () => {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE,
      IndexName: "stripe_session_id-index",
      KeyConditionExpression: "stripe_session_id = :sid",
      ExpressionAttributeValues: { ":sid": SESSION_ID },
      Select: "COUNT",
    }));
    expect(result.Count).toBe(1);
  });

  it("cycle 3: email was sent only once", () => {
    const licenseEmails = sesFake.sentEmails.filter((e) => e.type === "license");
    expect(licenseEmails).toHaveLength(1);
  });
});

// ── I.1.3 — Webhook: checkout.session.completed ────────────────────

describe("I.1.3 — Webhook checkout.session.completed", () => {
  it("cycle 1: redundant webhook for existing license is a no-op", async () => {
    const SESSION_ID = "cs_test_happy";
    const existingRecord = await getBySessionId(docClient, TABLE, SESSION_ID);
    expect(existingRecord).not.toBeNull();

    const { event, verify, parse } = makeWebhookEvent({
      type: "checkout.session.completed",
      sessionId: SESSION_ID,
    });

    const result = await handleWebhook(deps, event, verify, parse);
    expect(result.statusCode).toBe(200);

    const afterRecord = await getBySessionId(docClient, TABLE, SESSION_ID);
    expect(afterRecord!.license_id).toBe(existingRecord!.license_id);
  });

  it("cycle 2: webhook for new session creates license with valid PEM", async () => {
    const NEW_SESSION_ID = "cs_test_webhook_new";
    stripeFake.setSession({
      id: NEW_SESSION_ID,
      payment_status: "paid",
      customer_email: "webhook@test.com",
      customer_details: { name: "Webhook Buyer", email: "webhook@test.com" },
      created: 1700000000,
      payment_intent: { id: "pi_test_wh", latest_charge: "ch_test_wh" },
    });
    sesFake.reset();

    const { event, verify, parse } = makeWebhookEvent({
      type: "checkout.session.completed",
      sessionId: NEW_SESSION_ID,
    });

    const result = await handleWebhook(deps, event, verify, parse);
    expect(result.statusCode).toBe(200);

    const record = await getBySessionId(docClient, TABLE, NEW_SESSION_ID);
    expect(record).not.toBeNull();

    const { valid } = verifyPem(record!.license_key_pem, TEST_PUBLIC_KEY);
    expect(valid).toBe(true);
  });
});

// ── I.1.4 — Refund Revocation ──────────────────────────────────────

describe("I.1.4 — Refund Revocation", () => {
  const SESSION_ID = "cs_test_refund";
  const CHARGE_ID = "ch_test_refund";
  let refundLicenseId: string;

  it("setup: create a license to refund", async () => {
    stripeFake.setSession({
      id: SESSION_ID,
      payment_status: "paid",
      customer_email: "refund@test.com",
      customer_details: { name: "Refund Buyer", email: "refund@test.com" },
      created: 1700000000,
      payment_intent: { id: "pi_test_refund", latest_charge: CHARGE_ID },
    });
    sesFake.reset();

    const event = makeEvent({ queryStringParameters: { session_id: SESSION_ID } });
    const result = await handleLicense(deps, event);
    expect(result.statusCode).toBe(200);

    const record = await getBySessionId(docClient, TABLE, SESSION_ID);
    refundLicenseId = record!.license_id;
  });

  it("cycle 1: charge.refunded webhook returns 200", async () => {
    const { event, verify, parse } = makeWebhookEvent({
      type: "charge.refunded",
      chargeId: CHARGE_ID,
    });

    const result = await handleWebhook(deps, event, verify, parse);
    expect(result.statusCode).toBe(200);
  });

  it("cycle 2: DB record shows revoked with reason 'refund'", async () => {
    const record = await getByLicenseId(docClient, TABLE, refundLicenseId);
    expect(record!.status).toBe("revoked");
    expect(record!.revoked_reason).toBe("refund");
    expect(record!.revoked_at).toEqual(expect.any(Number));
  });

  it("cycle 3: handleValidate returns revoked status", async () => {
    const event = makeEvent({
      queryStringParameters: { license_id: refundLicenseId },
    });

    const result = await handleValidate(deps, event);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ status: "revoked", reason: "refund" });
  });
});

// ── I.1.5 — Dispute Revocation ─────────────────────────────────────

describe("I.1.5 — Dispute Revocation", () => {
  const SESSION_ID = "cs_test_dispute";
  const CHARGE_ID = "ch_test_dispute";
  let disputeLicenseId: string;

  it("setup: create a license to dispute", async () => {
    stripeFake.setSession({
      id: SESSION_ID,
      payment_status: "paid",
      customer_email: "dispute@test.com",
      customer_details: { name: "Dispute Buyer", email: "dispute@test.com" },
      created: 1700000000,
      payment_intent: { id: "pi_test_dispute", latest_charge: CHARGE_ID },
    });
    sesFake.reset();

    const event = makeEvent({ queryStringParameters: { session_id: SESSION_ID } });
    const result = await handleLicense(deps, event);
    expect(result.statusCode).toBe(200);

    const record = await getBySessionId(docClient, TABLE, SESSION_ID);
    disputeLicenseId = record!.license_id;
  });

  it("cycle 1: charge.dispute.created webhook revokes with reason 'dispute'", async () => {
    const { event, verify, parse } = makeWebhookEvent({
      type: "charge.dispute.created",
      chargeId: CHARGE_ID,
    });

    const result = await handleWebhook(deps, event, verify, parse);
    expect(result.statusCode).toBe(200);

    const record = await getByLicenseId(docClient, TABLE, disputeLicenseId);
    expect(record!.status).toBe("revoked");
    expect(record!.revoked_reason).toBe("dispute");
  });

  it("cycle 2: handleValidate returns revoked with reason 'dispute'", async () => {
    const event = makeEvent({
      queryStringParameters: { license_id: disputeLicenseId },
    });

    const result = await handleValidate(deps, event);
    expect(JSON.parse(result.body)).toEqual({ status: "revoked", reason: "dispute" });
  });
});

// ── I.1.6 — Recovery Flow ──────────────────────────────────────────

describe("I.1.6 — Recovery Flow", () => {
  const RECOVERY_EMAIL = "recover@test.com";
  const SESSION_ID = "cs_test_recover";
  const CHARGE_ID = "ch_test_recover";
  let recoveryLicenseId: string;

  it("setup: create an active license for recovery tests", async () => {
    stripeFake.setSession({
      id: SESSION_ID,
      payment_status: "paid",
      customer_email: RECOVERY_EMAIL,
      customer_details: { name: "Recover Buyer", email: RECOVERY_EMAIL },
      created: 1700000000,
      payment_intent: { id: "pi_test_recover", latest_charge: CHARGE_ID },
    });
    sesFake.reset();

    const event = makeEvent({ queryStringParameters: { session_id: SESSION_ID } });
    const result = await handleLicense(deps, event);
    expect(result.statusCode).toBe(200);

    const record = await getBySessionId(docClient, TABLE, SESSION_ID);
    recoveryLicenseId = record!.license_id;
    sesFake.reset();
  });

  it("cycle 1: handleRecover with known email returns 200 with generic message", async () => {
    const event = makeEvent({
      httpMethod: "POST",
      body: JSON.stringify({ email: RECOVERY_EMAIL }),
    });

    const result = await handleRecover(deps, event);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).message).toContain("recovery email");
  });

  it("cycle 2: recovery email sent with correct PEM", async () => {
    expect(sesFake.sentEmails).toHaveLength(1);
    expect(sesFake.sentEmails[0]!.type).toBe("recovery");
    expect(sesFake.sentEmails[0]!.to).toBe(RECOVERY_EMAIL);

    const record = await getByLicenseId(docClient, TABLE, recoveryLicenseId);
    expect(sesFake.sentEmails[0]!.pem).toBe(record!.license_key_pem);
  });

  it("cycle 3: handleRecover with unknown email returns identical 200, no new email", async () => {
    const countBefore = sesFake.sentEmails.length;

    const event = makeEvent({
      httpMethod: "POST",
      body: JSON.stringify({ email: "nobody@test.com" }),
    });

    const result = await handleRecover(deps, event);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).message).toContain("recovery email");
    expect(sesFake.sentEmails).toHaveLength(countBefore);
  });

  it("cycle 4: revoked license excluded from recovery", async () => {
    const { event: whEvent, verify, parse } = makeWebhookEvent({
      type: "charge.refunded",
      chargeId: CHARGE_ID,
    });
    await handleWebhook(deps, whEvent, verify, parse);

    const countBefore = sesFake.sentEmails.length;

    const event = makeEvent({
      httpMethod: "POST",
      body: JSON.stringify({ email: RECOVERY_EMAIL }),
    });

    await handleRecover(deps, event);
    expect(sesFake.sentEmails).toHaveLength(countBefore);
  });
});

// ── I.1.7 — Session Expiry (Time-Based Guard) ─────────────────────

describe("I.1.7 — Session Expiry", () => {
  const SESSION_ID = "cs_test_expiry";
  const SESSION_CREATED = 1700000000;

  it("setup: configure session for expiry tests", () => {
    stripeFake.setSession({
      id: SESSION_ID,
      payment_status: "paid",
      customer_email: "expiry@test.com",
      customer_details: { name: "Expiry Buyer", email: "expiry@test.com" },
      created: SESSION_CREATED,
      payment_intent: { id: "pi_test_expiry", latest_charge: "ch_test_expiry" },
    });
  });

  it("cycle 1: handleLicense returns 410 when session is older than 1 hour", async () => {
    clockFake.reset(SESSION_CREATED + 3601);

    const event = makeEvent({ queryStringParameters: { session_id: SESSION_ID } });
    const result = await handleLicense(deps, event);

    expect(result.statusCode).toBe(410);
    expect(result.body).toContain("expired");
  });

  it("cycle 2: handleSuccessPage returns 410 HTML with gonePageHtml", async () => {
    clockFake.reset(SESSION_CREATED + 3601);

    const event = makeEvent({ queryStringParameters: { session_id: SESSION_ID } });
    const result = await handleSuccessPage(deps, event);

    expect(result.statusCode).toBe(410);
    expect(result.headers!["Content-Type"]).toBe("text/html");
    expect(result.body).toContain("Link Expired");
  });

  it("cycle 3: handleLicense returns 200 when session is within 1 hour", async () => {
    clockFake.reset(SESSION_CREATED + 3599);

    const event = makeEvent({ queryStringParameters: { session_id: SESSION_ID } });
    const result = await handleLicense(deps, event);

    expect(result.statusCode).toBe(200);

    clockFake.reset(1700000000);
  });
});

// ── I.1.8 — Edge Cases ─────────────────────────────────────────────

describe("I.1.8 — Edge Cases", () => {
  it("cycle 1: charge.refunded for unknown charge ID is a graceful no-op", async () => {
    const before = await docClient.send(new ScanCommand({ TableName: TABLE }));
    const { event, verify, parse } = makeWebhookEvent({
      type: "charge.refunded",
      chargeId: "ch_nonexistent_xyz",
    });

    const result = await handleWebhook(deps, event, verify, parse);
    expect(result.statusCode).toBe(200);

    const after = await docClient.send(new ScanCommand({ TableName: TABLE }));
    const sortById = (items: Record<string, unknown>[]) =>
      [...items].sort((a, b) => String(a.license_id).localeCompare(String(b.license_id)));
    expect(sortById(after.Items as Record<string, unknown>[] ?? [])).toEqual(sortById(before.Items as Record<string, unknown>[] ?? []));
  });

  it("cycle 2: handleCheckout with invalid JSON returns 400", async () => {
    const event = makeEvent({
      httpMethod: "POST",
      body: "not-json{{{",
    });

    const result = await handleCheckout(deps, event);
    expect(result.statusCode).toBe(400);
  });

  it("cycle 3: handleLicense with unpaid session returns 402", async () => {
    stripeFake.setSession({
      id: "cs_test_unpaid",
      payment_status: "unpaid",
      customer_email: "unpaid@test.com",
      created: 1700000000,
    });

    const event = makeEvent({ queryStringParameters: { session_id: "cs_test_unpaid" } });
    const result = await handleLicense(deps, event);

    expect(result.statusCode).toBe(402);
  });

  it("cycle 4: handleValidate with nonexistent license_id returns valid (anti-enumeration)", async () => {
    const event = makeEvent({
      queryStringParameters: { license_id: "LIT-9999-NONEXISTENT" },
    });

    const result = await handleValidate(deps, event);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ status: "valid" });
  });
});

// ── Stripe Fake Correctness ───────────────────────────────────────

describe("Stripe fake correctness", () => {
  it("retrieve returns session matching requested ID, not last-set", async () => {
    stripeFake.setSession({ id: "cs_fake_A", payment_status: "paid", customer_email: "a@test.com", created: 1700000000 });
    stripeFake.setSession({ id: "cs_fake_B", payment_status: "paid", customer_email: "b@test.com", created: 1700000000 });
    const retrieved = await stripeFake.sessions.retrieve("cs_fake_A");
    expect(retrieved.id).toBe("cs_fake_A");
  });
});
