import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";
import type { Config } from "./types.js";

let cached: Config | null = null;

export function resetConfigCache(): void {
  cached = null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function loadConfig(ssm: SSMClient): Promise<Config> {
  if (cached) return cached;

  const tableName = requireEnv("TABLE_NAME");
  const stripePriceId = requireEnv("STRIPE_PRICE_ID");
  const baseUrl = requireEnv("BASE_URL");
  const sesFromEmail = requireEnv("SES_FROM_EMAIL");
  const ssmPrefix = process.env.SSM_PREFIX || "/lit/";

  const paramNames = [
    `${ssmPrefix}private-key`,
    `${ssmPrefix}stripe-secret-key`,
    `${ssmPrefix}webhook-secret`,
    `${ssmPrefix}early-access-deadline`,
    `${ssmPrefix}turnstile-secret`,
  ];

  const result = await ssm.send(
    new GetParametersCommand({
      Names: paramNames,
      WithDecryption: true,
    }),
  );

  const params = new Map<string, string>();
  for (const p of result.Parameters ?? []) {
    if (p.Name != null && p.Value != null) params.set(p.Name, p.Value);
  }

  function requireParam(name: string): string {
    const value = params.get(name);
    if (!value)
      throw new Error(`Missing required SSM parameter: ${name}`);
    return value;
  }

  const privateKeyB64 = requireParam(`${ssmPrefix}private-key`);
  const stripeSecretKey = requireParam(`${ssmPrefix}stripe-secret-key`);
  const webhookSecret = requireParam(`${ssmPrefix}webhook-secret`);
  const earlyAccessDeadline = parseInt(requireParam(`${ssmPrefix}early-access-deadline`), 10);
  const turnstileSecret = params.get(`${ssmPrefix}turnstile-secret`) || undefined;

  const privateKey = new Uint8Array(Buffer.from(privateKeyB64, "base64"));

  cached = {
    tableName,
    privateKey,
    stripeSecretKey,
    webhookSecret,
    baseUrl,
    sesFromEmail,
    stripePriceId,
    earlyAccessDeadline,
    turnstileSecret,
  };

  return cached;
}
