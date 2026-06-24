import { ed25519 } from "@noble/curves/ed25519";
import type { LicensePayload } from "../types.js";

export function buildPayloadJson(payload: LicensePayload): string {
  const { license_id, name, email, issued_at, type, expires_at } = payload;
  const obj: Record<string, unknown> = { license_id, name, email, issued_at, type };
  if (expires_at !== undefined) {
    obj.expires_at = expires_at;
  }
  return JSON.stringify(obj);
}

export function encodePayload(json: string): string {
  return Buffer.from(json).toString("base64");
}

export function signPayload(
  payloadB64: string,
  privateKey: Uint8Array,
): Uint8Array {
  return ed25519.sign(new TextEncoder().encode(payloadB64), privateKey);
}

const BEGIN_MARKER = "-----BEGIN LICENSE KEY-----";
const END_MARKER = "-----END LICENSE KEY-----";

export function formatPem(payloadB64: string, sigB64: string): string {
  return `${BEGIN_MARKER}\n${payloadB64}.${sigB64}\n${END_MARKER}`;
}

export function generateLicenseKey(
  payload: LicensePayload,
  privateKey: Uint8Array,
): string {
  const json = buildPayloadJson(payload);
  const payloadB64 = encodePayload(json);
  const sig = signPayload(payloadB64, privateKey);
  const sigB64 = Buffer.from(sig).toString("base64");
  return formatPem(payloadB64, sigB64);
}
