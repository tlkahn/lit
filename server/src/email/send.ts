import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import {
  licenseEmailHtml,
  licenseEmailText,
  recoveryEmailHtml,
  recoveryEmailText,
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
        Subject: { Data: subject },
        Body: {
          Html: { Data: html },
          Text: { Data: text },
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
  name: string,
  pem: string,
): Promise<void> {
  await sendEmail(
    ses,
    from,
    to,
    "Your recovered license key",
    recoveryEmailHtml(name, pem),
    recoveryEmailText(name, pem),
  );
}
