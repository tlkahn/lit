import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import {
  verifyWebhookEvent,
  parseWebhookEvent,
} from "../../src/stripe/webhook.js";

function makeStripeEvent(
  type: string,
  dataObject: Record<string, unknown>,
): Stripe.Event {
  return {
    id: "evt_test_123",
    type,
    data: { object: dataObject },
  } as unknown as Stripe.Event;
}

describe("verifyWebhookEvent", () => {
  it("calls stripe.webhooks.constructEvent with payload, signature, and secret", () => {
    const mockConstructEvent = vi.fn().mockReturnValue({ id: "evt_1", type: "test" });
    const stripe = {
      webhooks: { constructEvent: mockConstructEvent },
    } as unknown as Stripe;

    verifyWebhookEvent(stripe, "raw_body", "sig_header", "whsec_test");

    expect(mockConstructEvent).toHaveBeenCalledWith(
      "raw_body",
      "sig_header",
      "whsec_test",
    );
  });

  it("returns the verified Stripe event", () => {
    const fakeEvent = { id: "evt_abc", type: "checkout.session.completed" };
    const mockConstructEvent = vi.fn().mockReturnValue(fakeEvent);
    const stripe = {
      webhooks: { constructEvent: mockConstructEvent },
    } as unknown as Stripe;

    const result = verifyWebhookEvent(stripe, "body", "sig", "secret");

    expect(result).toBe(fakeEvent);
  });

  it("throws when signature verification fails", () => {
    const mockConstructEvent = vi.fn().mockImplementation(() => {
      throw new Error("Webhook signature verification failed");
    });
    const stripe = {
      webhooks: { constructEvent: mockConstructEvent },
    } as unknown as Stripe;

    expect(() =>
      verifyWebhookEvent(stripe, "tampered", "bad_sig", "secret"),
    ).toThrow("Webhook signature verification failed");
  });
});

describe("parseWebhookEvent", () => {
  it("returns sessionId for checkout.session.completed", () => {
    const event = makeStripeEvent("checkout.session.completed", {
      id: "cs_test_session_123",
    });

    const result = parseWebhookEvent(event);

    expect(result).toEqual({
      type: "checkout.session.completed",
      sessionId: "cs_test_session_123",
    });
  });

  it("returns chargeId for charge.refunded", () => {
    const event = makeStripeEvent("charge.refunded", {
      id: "ch_refunded_456",
    });

    const result = parseWebhookEvent(event);

    expect(result).toEqual({
      type: "charge.refunded",
      chargeId: "ch_refunded_456",
    });
  });

  it("returns chargeId for charge.dispute.created (string charge)", () => {
    const event = makeStripeEvent("charge.dispute.created", {
      id: "dp_789",
      charge: "ch_disputed_789",
    });

    const result = parseWebhookEvent(event);

    expect(result).toEqual({
      type: "charge.dispute.created",
      chargeId: "ch_disputed_789",
    });
  });

  it("returns chargeId for charge.dispute.created (expanded charge object)", () => {
    const event = makeStripeEvent("charge.dispute.created", {
      id: "dp_expanded",
      charge: { id: "ch_expanded_obj" },
    });

    const result = parseWebhookEvent(event);

    expect(result).toEqual({
      type: "charge.dispute.created",
      chargeId: "ch_expanded_obj",
    });
  });

  it("returns { type: null } for unhandled event types", () => {
    const event = makeStripeEvent("customer.subscription.updated", {
      id: "sub_xxx",
    });

    const result = parseWebhookEvent(event);

    expect(result).toEqual({ type: null });
  });
});
