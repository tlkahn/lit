import { describe, it, expect } from "vitest";
import {
  buildPayloadJson,
  encodePayload,
  signPayload,
  formatPem,
  generateLicenseKey,
} from "../../src/lib/license-key.js";
import { ed25519 } from "@noble/curves/ed25519";
import type { LicensePayload } from "../../src/types.js";

describe("license-key", () => {
  const payload: LicensePayload = {
    license_id: "LIT-2026-ABCD1234",
    name: "Alice Test",
    email: "alice@example.com",
    issued_at: 1700000000,
    type: "perpetual",
  };

  describe("buildPayloadJson", () => {
    it("produces JSON with 'type' field, not 'license_type'", () => {
      const json = buildPayloadJson(payload);
      const parsed = JSON.parse(json);
      expect(parsed.type).toBe("perpetual");
      expect(parsed).not.toHaveProperty("license_type");
    });
  });

  describe("encodePayload", () => {
    it("returns standard base64", () => {
      const json = '{"hello":"world"}';
      const b64 = encodePayload(json);
      expect(b64).toBe(Buffer.from(json).toString("base64"));
      expect(Buffer.from(b64, "base64").toString("utf-8")).toBe(json);
    });
  });

  describe("signPayload", () => {
    const privateKey = ed25519.utils.randomSecretKey();

    it("returns 64-byte signature", () => {
      const payloadB64 = "dGVzdA==";
      const sig = signPayload(payloadB64, privateKey);
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig.length).toBe(64);
    });

    it("signature verifies with corresponding public key", () => {
      const payloadB64 = "dGVzdA==";
      const sig = signPayload(payloadB64, privateKey);
      const publicKey = ed25519.getPublicKey(privateKey);
      const msg = new TextEncoder().encode(payloadB64);
      expect(ed25519.verify(sig, msg, publicKey)).toBe(true);
    });
  });

  describe("formatPem", () => {
    it("wraps in BEGIN/END LICENSE KEY markers", () => {
      const pem = formatPem("cGF5bG9hZA==", "c2lnbmF0dXJl");
      expect(pem).toContain("-----BEGIN LICENSE KEY-----");
      expect(pem).toContain("-----END LICENSE KEY-----");
    });

    it("matches Rust parser format: markers, single dot separator, no extra newlines", () => {
      const pem = formatPem("PAYLOAD", "SIGNATURE");
      const lines = pem.split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe("-----BEGIN LICENSE KEY-----");
      expect(lines[1]).toBe("PAYLOAD.SIGNATURE");
      expect(lines[2]).toBe("-----END LICENSE KEY-----");
      // Exactly one dot separating payload from signature
      const body = lines[1]!;
      const parts = body.split(".");
      expect(parts).toHaveLength(2);
      expect(parts[0]).toBe("PAYLOAD");
      expect(parts[1]).toBe("SIGNATURE");
    });
  });

  describe("generateLicenseKey", () => {
    const privateKey = ed25519.utils.randomSecretKey();

    it("returns complete valid PEM", () => {
      const pem = generateLicenseKey(payload, privateKey);
      expect(pem).toMatch(/^-----BEGIN LICENSE KEY-----\n.+\n-----END LICENSE KEY-----$/);
    });

    it("payload decodes to correct JSON fields", () => {
      const pem = generateLicenseKey(payload, privateKey);
      const lines = pem.split("\n");
      const body = lines[1]!;
      const [payloadB64] = body.split(".");
      const decoded = JSON.parse(Buffer.from(payloadB64!, "base64").toString("utf-8"));
      expect(decoded.license_id).toBe("LIT-2026-ABCD1234");
      expect(decoded.name).toBe("Alice Test");
      expect(decoded.email).toBe("alice@example.com");
      expect(decoded.issued_at).toBe(1700000000);
      expect(decoded.type).toBe("perpetual");
      expect(decoded).not.toHaveProperty("license_type");
    });

    it("cross-validation: sign + verify round-trip matches Rust convention", () => {
      const privateKey2 = ed25519.utils.randomSecretKey();
      const publicKey = ed25519.getPublicKey(privateKey2);

      const pem = generateLicenseKey(payload, privateKey2);
      const lines = pem.split("\n");
      expect(lines[0]).toBe("-----BEGIN LICENSE KEY-----");
      expect(lines[2]).toBe("-----END LICENSE KEY-----");

      const body = lines[1]!;
      const dotIdx = body.indexOf(".");
      const payloadB64 = body.slice(0, dotIdx);
      const sigB64 = body.slice(dotIdx + 1);

      // Rust verifies: ed25519.verify(sig, payload_b64_as_utf8_bytes, pubkey)
      const sig = new Uint8Array(Buffer.from(sigB64, "base64"));
      expect(sig.length).toBe(64);
      const msg = new TextEncoder().encode(payloadB64);
      expect(ed25519.verify(sig, msg, publicKey)).toBe(true);

      // Payload decodes to valid JSON with correct fields
      const decoded = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf-8"));
      expect(decoded.type).toBe("perpetual");
      expect(decoded.license_id).toBe(payload.license_id);
    });
  });
});
