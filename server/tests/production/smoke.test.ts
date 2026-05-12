import { describe, it, expect } from "vitest";

const BASE_URL = "https://lit.solar";

describe("Production smoke — S3 origin", () => {
  it("GET / returns 200 HTML", async () => {
    const response = await fetch(BASE_URL);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});

describe("Production smoke — API Gateway origin", () => {
  it("POST /api/checkout returns 303 to Stripe", async () => {
    const response = await fetch(`${BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "smoke@lit.solar" }),
      redirect: "manual",
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("checkout.stripe.com");
  });

  it("GET /api/validate?license_id=LIT-0000-X returns valid", async () => {
    const response = await fetch(`${BASE_URL}/api/validate?license_id=LIT-0000-X`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: "valid" });
  });
});

describe("Production smoke — Lambda-served pages", () => {
  const pages = [
    "/purchase/cancel",
    "/early-access",
    "/recover",
    "/privacy",
    "/refund",
  ];

  for (const path of pages) {
    it(`GET ${path} returns 200 HTML`, async () => {
      const response = await fetch(`${BASE_URL}${path}`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
    });
  }
});

describe("Production smoke — CloudFront headers", () => {
  it("response includes CloudFront headers", async () => {
    const response = await fetch(BASE_URL);
    const headers = Object.fromEntries(response.headers.entries());
    const cfHeaders = Object.keys(headers).filter(
      (h) => h.startsWith("x-amz-cf-") || h === "x-cache",
    );

    expect(cfHeaders.length).toBeGreaterThan(0);
  });
});
