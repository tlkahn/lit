export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function licenseEmailHtml(name: string, pem: string): string {
  return `<html><body>
<p>Hello ${escapeHtml(name)},</p>
<p>Here is your license key:</p>
<pre>${pem}</pre>
</body></html>`;
}

export function recoveryEmailHtml(pem: string): string {
  return `<html><body>
<p>Hello,</p>
<p>Here is your recovered license key:</p>
<pre>${pem}</pre>
</body></html>`;
}

export function licenseEmailText(name: string, pem: string): string {
  return `Hello ${name},

Here is your license key:

${pem}`;
}

export function recoveryEmailText(pem: string): string {
  return `Hello,

Here is your recovered license key:

${pem}`;
}

export function earlyAdopterEmailHtml(pem: string): string {
  return `<html><body>
<p>Hello,</p>
<p>Thank you for being an early adopter! Here is your license key:</p>
<pre>${pem}</pre>
</body></html>`;
}

export function earlyAdopterEmailText(pem: string): string {
  return `Hello,

Thank you for being an early adopter! Here is your license key:

${pem}`;
}
