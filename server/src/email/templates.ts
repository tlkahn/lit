export function licenseEmailHtml(name: string, pem: string): string {
  return `<html><body>
<p>Hello ${name},</p>
<p>Here is your license key:</p>
<pre>${pem}</pre>
</body></html>`;
}

export function recoveryEmailHtml(name: string, pem: string): string {
  return `<html><body>
<p>Hello ${name},</p>
<p>Here is your recovered license key:</p>
<pre>${pem}</pre>
</body></html>`;
}

export function licenseEmailText(name: string, pem: string): string {
  return `Hello ${name},

Here is your license key:

${pem}`;
}

export function recoveryEmailText(name: string, pem: string): string {
  return `Hello ${name},

Here is your recovered license key:

${pem}`;
}
