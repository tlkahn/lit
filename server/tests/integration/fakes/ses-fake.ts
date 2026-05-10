import type { EmailOps } from "../../../src/types.js";

interface SentEmail {
  type: "license" | "recovery";
  to: string;
  name?: string;
  pem: string;
}

export function createSesFake(): EmailOps & {
  sentEmails: SentEmail[];
  reset(): void;
} {
  const sentEmails: SentEmail[] = [];

  return {
    sentEmails,

    reset() {
      sentEmails.length = 0;
    },

    sendLicenseEmail(to: string, name: string, pem: string): Promise<void> {
      sentEmails.push({ type: "license", to, name, pem });
      return Promise.resolve();
    },

    sendRecoveryEmail(to: string, pem: string): Promise<void> {
      sentEmails.push({ type: "recovery", to, pem });
      return Promise.resolve();
    },
  };
}
