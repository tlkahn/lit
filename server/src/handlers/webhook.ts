import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { HandlerDeps, ParsedWebhookEvent } from "../types.js";
import type Stripe from "stripe";
import { generateAndStoreLicense } from "./shared.js";
import { createDeps, getStripeClient } from "../deps.js";

type VerifyFn = (payload: string, sig: string, secret: string) => Stripe.Event;
type ParseFn = (event: Stripe.Event) => ParsedWebhookEvent;

const verbose = process.env.LOG_LEVEL === "debug";

export async function handleWebhook(
  deps: HandlerDeps,
  event: APIGatewayProxyEvent,
  verify: VerifyFn,
  parse: ParseFn,
): Promise<APIGatewayProxyResult> {
  const sigKey = Object.keys(event.headers).find((k) => k.toLowerCase() === "stripe-signature");
  const signature = sigKey ? event.headers[sigKey] : undefined;
  if (!signature) {
    return { statusCode: 400, body: "Missing stripe-signature header" };
  }

  const body = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf-8")
    : (event.body ?? "");

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = verify(body, signature, deps.config.webhookSecret);
  } catch (err) {
    if (verbose) console.error("Signature verification failed:", err);
    return { statusCode: 400, body: "Invalid signature" };
  }

  const parsed = parse(stripeEvent);
  if (verbose) console.log("Webhook event:", parsed.type, "session:", "sessionId" in parsed ? parsed.sessionId : "n/a");

  try {
    if (parsed.type === "checkout.session.completed") {
      const existing = await deps.db.getBySessionId(parsed.sessionId);
      if (!existing) {
        const session = parsed.session ?? await deps.stripe.sessions.retrieve(parsed.sessionId);
        await generateAndStoreLicense(session, deps);
        if (verbose) console.log("License created for session:", parsed.sessionId);
      } else {
        if (verbose) console.log("License already exists for session:", parsed.sessionId);
      }
    } else if (parsed.type === "charge.refunded" || parsed.type === "charge.dispute.created") {
      const reason = parsed.type === "charge.refunded" ? "refund" : "dispute";
      const record = await deps.db.getByChargeId(parsed.chargeId);
      if (record) {
        await deps.db.revokeLicense(record.license_id, reason);
      }
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
  }

  return { statusCode: 200, body: "" };
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const { verifyWebhookEvent, parseWebhookEvent } = await import("../stripe/webhook.js");
  const deps = await createDeps();
  const stripe = getStripeClient();
  const verify: VerifyFn = (payload, sig, secret) =>
    verifyWebhookEvent(stripe, payload, sig, secret);
  return handleWebhook(deps, event, verify, parseWebhookEvent);
};
