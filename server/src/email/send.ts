import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import type { EmailOps } from "../types.js";
import {
  licenseEmailHtml,
  licenseEmailText,
  recoveryEmailHtml,
  recoveryEmailText,
  earlyAdopterEmailHtml,
  earlyAdopterEmailText,
  trialEmailHtml,
  trialEmailText,
} from "./templates.js";

async function sendEmail(
  ses: SESClient,
  from: string,
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<void> {
  await ses.send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: html, Charset: "UTF-8" },
          Text: { Data: text, Charset: "UTF-8" },
        },
      },
    }),
  );
}

export async function sendLicenseEmail(
  ses: SESClient,
  from: string,
  to: string,
  name: string,
  pem: string,
): Promise<void> {
  await sendEmail(
    ses,
    from,
    to,
    "Your license key",
    licenseEmailHtml(name, pem),
    licenseEmailText(name, pem),
  );
}

export async function sendRecoveryEmail(
  ses: SESClient,
  from: string,
  to: string,
  pem: string,
): Promise<void> {
  await sendEmail(
    ses,
    from,
    to,
    "Your recovered license key",
    recoveryEmailHtml(pem),
    recoveryEmailText(pem),
  );
}

export async function sendEarlyAdopterEmail(
  ses: SESClient,
  from: string,
  to: string,
  pem: string,
): Promise<void> {
  await sendEmail(
    ses,
    from,
    to,
    "Your early-adopter license key",
    earlyAdopterEmailHtml(pem),
    earlyAdopterEmailText(pem),
  );
}

export async function sendTrialEmail(
  ses: SESClient,
  from: string,
  to: string,
  pem: string,
  expiryDate: string,
): Promise<void> {
  await sendEmail(
    ses,
    from,
    to,
    "Your 7-day trial license key",
    trialEmailHtml(pem, expiryDate),
    trialEmailText(pem, expiryDate),
  );
}

export function createEmailOps(ses: SESClient, from: string): EmailOps {
  return {
    sendLicenseEmail: (to, name, pem) =>
      sendLicenseEmail(ses, from, to, name, pem),
    sendRecoveryEmail: (to, pem) =>
      sendRecoveryEmail(ses, from, to, pem),
    sendEarlyAdopterEmail: (to, pem) =>
      sendEarlyAdopterEmail(ses, from, to, pem),
    sendTrialEmail: (to, pem, expiryDate) =>
      sendTrialEmail(ses, from, to, pem, expiryDate),
  };
}
