import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { sendLicenseEmail, sendRecoveryEmail } from "../../src/email/send.js";

const mockSend = vi.fn();
const ses = { send: mockSend } as unknown as SESClient;

const from = "noreply@lit.solar";
const to = "alice@example.com";
const pem = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAtest1234567890abcdef
-----END PUBLIC KEY-----`;

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({});
});

describe("sendLicenseEmail", () => {
  it("calls SES send with correct params", async () => {
    await sendLicenseEmail(ses, from, to, "Alice", pem);

    expect(mockSend).toHaveBeenCalledOnce();
    const cmd = mockSend.mock.calls[0]![0] as SendEmailCommand;
    const input = cmd.input;
    expect(input.Source).toBe(from);
    expect(input.Destination?.ToAddresses).toEqual([to]);
    expect(input.Message?.Subject?.Data).toBeDefined();
    expect(input.Message?.Body?.Html?.Data).toContain(`<pre>${pem}</pre>`);
  });

  it("includes both Html and Text body in the command", async () => {
    await sendLicenseEmail(ses, from, to, "Alice", pem);

    const cmd = mockSend.mock.calls[0]![0] as SendEmailCommand;
    const body = cmd.input.Message?.Body;
    expect(body?.Html?.Data).toBeTruthy();
    expect(body?.Text?.Data).toBeTruthy();
    expect(body?.Text?.Data).not.toMatch(/<pre>|<html>/);
  });
});

describe("sendRecoveryEmail", () => {
  it("uses a recovery-specific subject line", async () => {
    await sendLicenseEmail(ses, from, to, "Alice", pem);
    await sendRecoveryEmail(ses, from, to, "Bob", pem);

    const licenseCmd = mockSend.mock.calls[0]![0] as SendEmailCommand;
    const recoveryCmd = mockSend.mock.calls[1]![0] as SendEmailCommand;
    const licenseSubject = licenseCmd.input.Message?.Subject?.Data ?? "";
    const recoverySubject = recoveryCmd.input.Message?.Subject?.Data ?? "";

    expect(recoverySubject.toLowerCase()).toContain("recover");
    expect(recoverySubject).not.toBe(licenseSubject);
  });
});
