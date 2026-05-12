import { escapeHtml } from "../email/templates.js";
import { pageHtml } from "./layout.js";

export function successPageHtml(pem: string, name: string): string {
  return pageHtml("License Key — Lit", `\
<h1>Thank you, ${escapeHtml(name)}!</h1>
<p>Here is your license key:</p>
<pre>${escapeHtml(pem)}</pre>
<p><a class="cta" href="lit://activate?key=${encodeURIComponent(pem)}">Open in Lit</a></p>
<p>You can also copy the key above and paste it into the app.</p>
<p>A copy has also been emailed to you.</p>
<hr>
<p class="footer"><a href="/privacy">Privacy Policy</a> · <a href="/refund">Refund Policy</a></p>`);
}

export function gonePageHtml(): string {
  return pageHtml("Link Expired — Lit", `\
<h1>Link Expired</h1>
<p>This link has expired. Please check your email for a copy of your license key.</p>`);
}
