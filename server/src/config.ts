import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";
import type { Config } from "./types.js";

let cached: Config | null = null;

export function resetConfigCache(): void {
  cached = null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function loadConfig(ssm: SSMClient): Promise<Config> {
  if (cached) return cached;

  const tableName = requireEnv("TABLE_NAME");
  const stripePriceId = requireEnv("STRIPE_PRICE_ID");
  const baseUrl = requireEnv("BASE_URL");
  const sesFromEmail = requireEnv("SES_FROM_EMAIL");

  const result = await ssm.send(
    new GetParametersCommand({
      Names: [
        "/lit/private-key",
        "/lit/stripe-secret-key",
        "/lit/webhook-secret",
      ],
      WithDecryption: true,
    }),
  );

  const params = new Map(
    result.Parameters?.map((p) => [p.Name!, p.Value!]) ?? [],
  );

  function requireParam(name: string): string {
    const value = params.get(name);
    if (!value)
      throw new Error(`Missing required SSM parameter: ${name}`);
    return value;
  }

  const privateKeyB64 = requireParam("/lit/private-key");
  const stripeSecretKey = requireParam("/lit/stripe-secret-key");
  const webhookSecret = requireParam("/lit/webhook-secret");

  const privateKey = Uint8Array.from(atob(privateKeyB64), (c) =>
    c.charCodeAt(0),
  );

  cached = {
    tableName,
    privateKey,
    stripeSecretKey,
    webhookSecret,
    baseUrl,
    sesFromEmail,
    stripePriceId,
  };

  return cached;
}
