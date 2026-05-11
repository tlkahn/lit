import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { HandlerDeps, ParsedWebhookEvent } from "../types.js";
import type Stripe from "stripe";
import { generateAndStoreLicense } from "./shared.js";
import { createDeps, getStripeClient } from "../deps.js";

type VerifyFn = (payload: string, sig: string, secret: string) => Stripe.Event;
type ParseFn = (event: Stripe.Event) => ParsedWebhookEvent;

export async function handleWebhook(
  deps: HandlerDeps,
  event: APIGatewayProxyEvent,
  verify: VerifyFn,
  parse: ParseFn,
): Promise<APIGatewayProxyResult> {
  const signature = event.headers["stripe-signature"];
  if (!signature) {
    return { statusCode: 400, body: "Missing stripe-signature header" };
  }

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = verify(event.body ?? "", signature, deps.config.webhookSecret);
  } catch {
    return { statusCode: 400, body: "Invalid signature" };
  }

  const parsed = parse(stripeEvent);

  try {
    if (parsed.type === "checkout.session.completed") {
      const existing = await deps.db.getBySessionId(parsed.sessionId);
      if (!existing) {
        const session = await deps.stripe.sessions.retrieve(parsed.sessionId);
        await generateAndStoreLicense(session, deps);
      }
    } else if (parsed.type === "charge.refunded" || parsed.type === "charge.dispute.created") {
      const reason = parsed.type === "charge.refunded" ? "refund" : "dispute";
      const record = await deps.db.getByChargeId(parsed.chargeId);
      if (record) {
        await deps.db.revokeLicense(record.license_id, reason);
      }
    }
  } catch {
    // Swallow errors to prevent Stripe retry flood
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
