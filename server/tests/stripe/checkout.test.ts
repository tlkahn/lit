import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
import { createCheckoutSession } from "../../src/stripe/checkout.js";

const mockCreate = vi.fn();
const stripe = {
  checkout: { sessions: { create: mockCreate } },
} as unknown as Stripe;

const baseParams = {
  priceId: "price_test_abc",
  baseUrl: "https://lit.solar",
};

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
    url: "https://checkout.stripe.com/c/pay/cs_test_xxx",
    id: "cs_test_xxx",
  });
});

describe("createCheckoutSession", () => {
  it("calls stripe.checkout.sessions.create with mode, line_items, and automatic_tax", async () => {
    await createCheckoutSession(stripe, baseParams);

    expect(mockCreate).toHaveBeenCalledOnce();
    const args = mockCreate.mock.calls[0]![0];
    expect(args.mode).toBe("payment");
    expect(args.line_items).toEqual([{ price: "price_test_abc", quantity: 1 }]);
    expect(args.automatic_tax).toEqual({ enabled: true });
  });

  it("sets success_url with session_id template and cancel_url from baseUrl", async () => {
    await createCheckoutSession(stripe, baseParams);

    const args = mockCreate.mock.calls[0]![0];
    expect(args.success_url).toBe(
      "https://lit.solar/purchase/success?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(args.cancel_url).toBe("https://lit.solar/purchase/cancel");
  });

  it("includes customer_email when provided", async () => {
    await createCheckoutSession(stripe, {
      ...baseParams,
      customerEmail: "buyer@example.com",
    });

    const args = mockCreate.mock.calls[0]![0];
    expect(args.customer_email).toBe("buyer@example.com");
  });

  it("omits customer_email when not provided", async () => {
    await createCheckoutSession(stripe, baseParams);

    const args = mockCreate.mock.calls[0]![0];
    expect(args).not.toHaveProperty("customer_email");
  });

  it("includes customer_email even when it is an empty string", async () => {
    await createCheckoutSession(stripe, {
      ...baseParams,
      customerEmail: "",
    });

    const args = mockCreate.mock.calls[0]![0];
    expect(args).toHaveProperty("customer_email");
    expect(args.customer_email).toBe("");
  });

  it("returns url and id from the created session", async () => {
    mockCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/cs_live_abc",
      id: "cs_live_abc",
    });

    const result = await createCheckoutSession(stripe, baseParams);

    expect(result).toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_live_abc",
      id: "cs_live_abc",
    });
  });

  it("throws when Stripe returns a null url", async () => {
    mockCreate.mockResolvedValue({ url: null, id: "cs_test_no_url" });

    await expect(
      createCheckoutSession(stripe, baseParams),
    ).rejects.toThrow("Stripe returned no checkout URL");
  });

  it("propagates Stripe API errors", async () => {
    mockCreate.mockRejectedValue(new Error("Invalid API Key"));

    await expect(
      createCheckoutSession(stripe, baseParams),
    ).rejects.toThrow("Invalid API Key");
  });
});
