import { ed25519 } from "@noble/curves/ed25519";
import type { LicensePayload } from "../../../src/types.js";

const SEED = new Uint8Array([
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
  0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
  0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
]);

export const TEST_PRIVATE_KEY: Uint8Array = SEED;
export const TEST_PUBLIC_KEY: Uint8Array = ed25519.getPublicKey(SEED);

export function verifyPem(
  pem: string,
  publicKey: Uint8Array,
): { valid: boolean; payload: LicensePayload } {
  const inner = pem
    .replace("-----BEGIN LICENSE KEY-----", "")
    .replace("-----END LICENSE KEY-----", "")
    .trim();

  const dotIndex = inner.lastIndexOf(".");
  if (dotIndex === -1) {
    return { valid: false, payload: {} as LicensePayload };
  }

  const payloadB64 = inner.slice(0, dotIndex);
  const sigB64 = inner.slice(dotIndex + 1);

  const signature = Uint8Array.from(Buffer.from(sigB64, "base64"));
  const message = new TextEncoder().encode(payloadB64);

  const valid = ed25519.verify(signature, message, publicKey);
  const payloadJson = Buffer.from(payloadB64, "base64").toString("utf-8");
  const payload: LicensePayload = JSON.parse(payloadJson);

  return { valid, payload };
}
