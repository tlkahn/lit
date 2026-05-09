import { randomBytes } from "node:crypto";

export function generateLicenseId(yearOverride?: number): string {
  const year = yearOverride ?? new Date().getFullYear();
  const n = randomBytes(6).readUIntBE(0, 6);
  const random = n.toString(36).toUpperCase().padStart(8, "0").slice(0, 8);
  return `LIT-${year}-${random}`;
}
