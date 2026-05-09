import { ed25519 } from "@noble/curves/ed25519";
import type { LicensePayload } from "../types.js";

export function buildPayloadJson(payload: LicensePayload): string {
  const { license_id, name, email, issued_at, type } = payload;
  return JSON.stringify({ license_id, name, email, issued_at, type });
}

export function encodePayload(json: string): string {
  return Buffer.from(json).toString("base64");
}

export function signPayload(
  payloadB64: string,
  privateKey: Uint8Array,
): Uint8Array {
  return ed25519.sign(Buffer.from(payloadB64, "utf-8"), privateKey);
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
