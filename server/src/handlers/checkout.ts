import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { HandlerDeps } from "../types.js";

export async function handleCheckout(
  deps: HandlerDeps,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  let parsed: Record<string, unknown>;
  try {
    parsed = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, body: "Invalid JSON body" };
  }

  try {
    const email = parsed.email as string | undefined;

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
