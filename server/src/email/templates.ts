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

export function recoveryEmailHtml(name: string, pem: string): string {
  return `<html><body>
<p>Hello ${escapeHtml(name)},</p>
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
