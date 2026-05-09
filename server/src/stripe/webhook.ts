import Stripe from "stripe";
import type { ParsedWebhookEvent } from "../types.js";

export function verifyWebhookEvent(
  stripe: Stripe,
  payload: string | Buffer,
  signature: string,
  webhookSecret: string,
): Stripe.Event {
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

export function parseWebhookEvent(event: Stripe.Event): ParsedWebhookEvent {
  switch (event.type) {
    case "checkout.session.completed":
      return {
        type: "checkout.session.completed",
        sessionId: (event.data.object as { id: string }).id,
      };
    case "charge.refunded":
      return {
        type: "charge.refunded",
        chargeId: (event.data.object as { id: string }).id,
      };
    case "charge.dispute.created": {
      const dispute = event.data.object as { charge: string | { id: string } };
      const chargeId =
        typeof dispute.charge === "string"
          ? dispute.charge
          : dispute.charge.id;
      return { type: "charge.dispute.created", chargeId };
    }
    default:
      return { type: null };
  }
}
