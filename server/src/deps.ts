import { SSMClient } from "@aws-sdk/client-ssm";
import { SESClient } from "@aws-sdk/client-ses";
import Stripe from "stripe";
import { loadConfig } from "./config.js";
import { createDocClient } from "./db/client.js";
import { createDbOps } from "./db/licenses.js";
import { createEmailOps } from "./email/send.js";
import { createCheckoutSession } from "./stripe/checkout.js";
import { generateLicenseKey } from "./lib/license-key.js";
import { generateLicenseId } from "./lib/license-id.js";
import { computeEmailHash } from "./lib/email-hash.js";
import { nowEpochSeconds, isOlderThan } from "./lib/time.js";
import type { HandlerDeps } from "./types.js";

let cached: HandlerDeps | null = null;
let cachedStripeClient: Stripe | null = null;

export function resetDepsCache(): void {
  cached = null;
  cachedStripeClient = null;
}

export function getStripeClient(): Stripe {
  if (!cachedStripeClient) throw new Error("createDeps() must be called before getStripeClient()");
  return cachedStripeClient;
}

export async function createDeps(): Promise<HandlerDeps> {
  if (cached) return cached;

  const ssm = new SSMClient({});
  const config = await loadConfig(ssm);

  const docClient = createDocClient();
  const db = createDbOps(docClient, config.tableName);

  const stripe = new Stripe(config.stripeSecretKey);
  cachedStripeClient = stripe;
  const ses = new SESClient({});
  const email = createEmailOps(ses, config.sesFromEmail);

  const deps: HandlerDeps = {
    db,
    stripe: {
      sessions: {
        retrieve: async (id) => {
          const s = await stripe.checkout.sessions.retrieve(id, { expand: ["payment_intent.latest_charge"] });
          return {
            id: s.id,
            payment_status: s.payment_status,
            customer_email: s.customer_email,
            customer_details: s.customer_details ?? undefined,
            created: s.created,
            payment_intent: s.payment_intent as string | { id: string; latest_charge?: string | { id: string } | null } | null | undefined,
          };
        },
      },
      checkout: {
        create: (params) => createCheckoutSession(stripe, params),
      },
    },
    email,
    config,
    clock: { nowEpochSeconds, isOlderThan },
    generateLicenseKey,
    generateLicenseId,
    computeEmailHash,
  };

  cached = deps;
  return deps;
}
