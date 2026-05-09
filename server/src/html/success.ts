import { escapeHtml } from "../email/templates.js";

export function successPageHtml(pem: string, name: string): string {
  return `<html><body>
<h1>Thank you, ${escapeHtml(name)}!</h1>
<p>Here is your license key:</p>
<pre>${pem}</pre>
<p><a href="lit://activate?key=${encodeURIComponent(pem)}">Open in Lit</a></p>
<p>You can also copy the key above and paste it into the app.</p>
<p>A copy has also been emailed to you.</p>
</body></html>`;
}

export function gonePageHtml(): string {
  return `<html><body>
<h1>Link Expired</h1>
<p>This link has expired. Please check your email for a copy of your license key.</p>
</body></html>`;
}
