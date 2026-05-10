import Stripe from "stripe";

interface CheckoutResult {
  sessionId: string;
  paymentIntentId: string;
}

export async function createAndCompleteCheckout(
  stripeKey: string,
  baseUrl: string,
  email: string,
): Promise<CheckoutResult> {
  const response = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    redirect: "manual",
  });

  const location = response.headers.get("location");
  if (!location) {
    throw new Error(`Checkout did not redirect — status ${response.status}`);
  }

  const sessionIdMatch = location.match(/cs_test_[a-zA-Z0-9]+/);
  if (!sessionIdMatch) {
    throw new Error(`Could not extract session ID from redirect: ${location}`);
  }
  const sessionId = sessionIdMatch[0];

  const stripe = new Stripe(stripeKey);
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  const piId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!piId) {
    throw new Error("No PaymentIntent found on session");
  }

  const pi = await stripe.paymentIntents.retrieve(piId);
  if (pi.status === "succeeded") {
    return { sessionId, paymentIntentId: piId };
  }
  if (pi.status !== "requires_payment_method" && pi.status !== "requires_confirmation") {
    throw new Error(
      `PaymentIntent ${piId} is in unexpected status "${pi.status}" — cannot confirm`,
    );
  }

  try {
    await stripe.paymentIntents.confirm(piId, {
      payment_method: "pm_card_visa",
    });
  } catch (err) {
    throw new Error(
      `Failed to confirm PaymentIntent ${piId} (status was "${pi.status}"): ${err instanceof Error ? err.message : err}`,
    );
  }

  return { sessionId, paymentIntentId: piId };
}
