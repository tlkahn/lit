import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { HandlerDeps } from "../types.js";
import { createDeps } from "../deps.js";
import { validateTurnstile } from "../lib/turnstile.js";

function parseBody(event: APIGatewayProxyEvent): { email?: string; turnstileToken?: string } {
  const ct = (event.headers["content-type"] || event.headers["Content-Type"] || "").toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(event.body || "");
    return {
      email: params.get("email") || undefined,
      turnstileToken: params.get("cf-turnstile-response") || undefined,
    };
  }
  const parsed = event.body ? JSON.parse(event.body) : {};
  return {
    email: parsed.email as string | undefined,
    turnstileToken: parsed["cf-turnstile-response"] as string | undefined,
  };
}

export async function handleCheckout(
  deps: HandlerDeps,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  let body: { email?: string; turnstileToken?: string };
  try {
    body = parseBody(event);
  } catch {
    return { statusCode: 400, body: "Invalid JSON body" };
  }

  if (deps.config.turnstileSecret) {
    if (!body.turnstileToken) {
      return { statusCode: 403, body: "Bot verification required" };
    }
    const valid = await validateTurnstile(deps.config.turnstileSecret, body.turnstileToken);
    if (!valid) {
      return { statusCode: 403, body: "Bot verification failed" };
    }
  }

  try {
    const { email } = body;

    const { url } = await deps.stripe.checkout.create({
      priceId: deps.config.stripePriceId,
      baseUrl: deps.config.baseUrl,
      ...(email && { customerEmail: email }),
    });

    return {
      statusCode: 303,
      headers: { Location: url },
      body: "",
    };
  } catch {
    return { statusCode: 500, body: "Internal server error" };
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const deps = await createDeps();
  return handleCheckout(deps, event);
};
