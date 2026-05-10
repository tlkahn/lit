import type { StripeOps, CheckoutParams, CheckoutResult } from "../../../src/types.js";

interface StripeSession {
  id: string;
  payment_status: string;
  customer_email: string | null;
  customer_details?: { name?: string | null; email?: string | null };
  created: number;
  payment_intent?:
    | string
    | { id: string; latest_charge?: string | { id: string } | null }
    | null;
}

interface CallRecord {
  method: string;
  args: unknown[];
  timestamp: number;
}

export function createStripeFake(): StripeOps & {
  calls: CallRecord[];
  setSession(session: StripeSession): void;
  reset(): void;
} {
  let session: StripeSession | null = null;
  const calls: CallRecord[] = [];

  return {
    calls,

    setSession(s: StripeSession) {
      session = s;
    },

    reset() {
      session = null;
      calls.length = 0;
    },

    sessions: {
      retrieve(sessionId: string) {
        calls.push({ method: "sessions.retrieve", args: [sessionId], timestamp: Date.now() });
        if (!session) throw new Error(`StripeFake: no session configured (requested ${sessionId})`);
        return Promise.resolve(session);
      },
    },

    checkout: {
      create(params: CheckoutParams): Promise<CheckoutResult> {
        calls.push({ method: "checkout.create", args: [params], timestamp: Date.now() });
        return Promise.resolve({
          url: "https://checkout.stripe.test/cs_fake_123",
          id: "cs_fake_123",
        });
      },
    },
  };
}
