import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import {
  sendLicenseEmail,
  sendRecoveryEmail,
  createEmailOps,
} from "../../src/email/send.js";
import type { EmailOps } from "../../src/types.js";

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

  it("sets UTF-8 Charset on Subject, Html, and Text fields", async () => {
    await sendLicenseEmail(ses, from, to, "Alice", pem);
    const cmd = mockSend.mock.calls[0]![0] as SendEmailCommand;
    const msg = cmd.input.Message!;
    expect(msg.Subject?.Charset).toBe("UTF-8");
    expect(msg.Body?.Html?.Charset).toBe("UTF-8");
    expect(msg.Body?.Text?.Charset).toBe("UTF-8");
  });
});

describe("sendRecoveryEmail", () => {
  it("uses a recovery-specific subject line", async () => {
    await sendLicenseEmail(ses, from, to, "Alice", pem);
    await sendRecoveryEmail(ses, from, to, pem);

    const licenseCmd = mockSend.mock.calls[0]![0] as SendEmailCommand;
    const recoveryCmd = mockSend.mock.calls[1]![0] as SendEmailCommand;
    const licenseSubject = licenseCmd.input.Message?.Subject?.Data ?? "";
    const recoverySubject = recoveryCmd.input.Message?.Subject?.Data ?? "";

    expect(recoverySubject.toLowerCase()).toContain("recover");
    expect(recoverySubject).not.toBe(licenseSubject);
  });

  it("sets UTF-8 Charset on all content fields", async () => {
    await sendRecoveryEmail(ses, from, to, pem);
    const cmd = mockSend.mock.calls[0]![0] as SendEmailCommand;
    const msg = cmd.input.Message!;
    expect(msg.Subject?.Charset).toBe("UTF-8");
    expect(msg.Body?.Html?.Charset).toBe("UTF-8");
    expect(msg.Body?.Text?.Charset).toBe("UTF-8");
  });
});

describe("createEmailOps", () => {
  it("returns an object satisfying the EmailOps interface", () => {
    const ops: EmailOps = createEmailOps(ses, from);
    expect(typeof ops.sendLicenseEmail).toBe("function");
    expect(typeof ops.sendRecoveryEmail).toBe("function");
  });

  it("sendLicenseEmail delegates to SES with closed-over ses and from", async () => {
    const ops = createEmailOps(ses, from);
    await ops.sendLicenseEmail(to, "Alice", pem);
    expect(mockSend).toHaveBeenCalledOnce();
    const cmd = mockSend.mock.calls[0]![0] as SendEmailCommand;
    expect(cmd.input.Source).toBe(from);
    expect(cmd.input.Destination?.ToAddresses).toEqual([to]);
  });

  it("sendRecoveryEmail delegates to SES with closed-over ses and from", async () => {
    const ops = createEmailOps(ses, from);
    await ops.sendRecoveryEmail(to, pem);
    expect(mockSend).toHaveBeenCalledOnce();
    const cmd = mockSend.mock.calls[0]![0] as SendEmailCommand;
    expect(cmd.input.Source).toBe(from);
    expect(cmd.input.Message?.Subject?.Data).toContain("recover");
  });

  it("sendLicenseEmail adapter accepts 3 args, sendRecoveryEmail accepts 2", () => {
    const ops = createEmailOps(ses, from);
    expect(ops.sendLicenseEmail.length).toBe(3);
    expect(ops.sendRecoveryEmail.length).toBe(2);
  });
});
