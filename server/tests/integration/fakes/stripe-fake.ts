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
  const sessionStore = new Map<string, StripeSession>();
  const calls: CallRecord[] = [];

  return {
    calls,

    setSession(s: StripeSession) {
      sessionStore.set(s.id, s);
    },

    reset() {
      sessionStore.clear();
      calls.length = 0;
    },

    sessions: {
      retrieve(sessionId: string) {
        calls.push({ method: "sessions.retrieve", args: [sessionId], timestamp: Date.now() });
        const s = sessionStore.get(sessionId);
        if (!s) throw new Error(`StripeFake: no session configured (requested ${sessionId})`);
        return Promise.resolve(s);
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
