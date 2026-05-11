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
    case "checkout.session.completed": {
      const obj = event.data.object as unknown as Record<string, unknown>;
      return {
        type: "checkout.session.completed",
        sessionId: obj.id as string,
        session: {
          id: obj.id as string,
          payment_status: obj.payment_status as string,
          customer_email: (obj.customer_email as string | null) ?? null,
          customer_details: obj.customer_details as { name?: string | null; email?: string | null } | undefined,
          created: obj.created as number,
          payment_intent: obj.payment_intent as string | { id: string; latest_charge?: string | { id: string } | null } | null | undefined,
        },
      };
    }
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
