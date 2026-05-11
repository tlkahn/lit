import Stripe from "stripe";

export interface CheckoutResult {
  sessionId: string;
  paymentIntentId: string;
  chargeId: string;
}

export async function createAndCompleteCheckout(
  stripeKey: string,
  webhookSecret: string,
  baseUrl: string,
  email: string,
): Promise<CheckoutResult> {
  // 1. POST /api/checkout → extract cs_test_* session ID from redirect
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

  // 2. Create a confirmed PaymentIntent directly (bypasses browser checkout)
  const stripe = new Stripe(stripeKey);
  const pi = await stripe.paymentIntents.create({
    amount: 2900,
    currency: "usd",
    payment_method: "pm_card_visa",
    confirm: true,
    receipt_email: email,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });

  const paymentIntentId = pi.id;

  // 3. Extract charge ID from the confirmed PI
  const chargeId =
    typeof pi.latest_charge === "string"
      ? pi.latest_charge
      : pi.latest_charge?.id;
  if (!chargeId) {
    throw new Error(`No charge found on PaymentIntent ${paymentIntentId}`);
  }

  // 4. Construct synthetic checkout.session.completed webhook payload
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    id: `evt_synthetic_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "paid",
        customer_email: email,
        customer_details: { name: email.split("@")[0], email },
        created: now,
        payment_intent: {
          id: paymentIntentId,
          latest_charge: chargeId,
        },
      },
    },
  });

  // 5. Sign it with the webhook secret
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });

  // 6. POST to /api/webhook with signed payload
  const webhookResponse = await fetch(`${baseUrl}/api/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });

  if (webhookResponse.status !== 200) {
    const body = await webhookResponse.text();
    throw new Error(`Webhook POST failed with ${webhookResponse.status}: ${body}`);
  }

  return { sessionId, paymentIntentId, chargeId };
}
