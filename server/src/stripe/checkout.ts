import Stripe from "stripe";
import type { CheckoutParams, CheckoutResult } from "../types.js";

export async function createCheckoutSession(
  stripe: Stripe,
  params: CheckoutParams,
): Promise<CheckoutResult> {
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: params.priceId, quantity: 1 }],
    automatic_tax: { enabled: true },
    success_url: `${params.baseUrl}/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${params.baseUrl}/purchase/cancel`,
    ...(params.customerEmail && { customer_email: params.customerEmail }),
  });
  if (!session.url) {
    throw new Error("Stripe returned no checkout URL");
  }
  return { url: session.url, id: session.id };
}
