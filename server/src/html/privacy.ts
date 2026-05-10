export function privacyPageHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Privacy Policy — Lit</title></head><body>
<h1>Privacy Policy</h1>
<p><strong>Effective date:</strong> May 10, 2026</p>
<p><strong>Operator:</strong> Lit Solar Software LLC, Delaware, USA</p>

<h2>What We Collect</h2>
<p>When you purchase or claim a license for Lit, we store:</p>
<ul>
<li><strong>Email hash</strong> — a one-way SHA-256 hash of your email address, used for license recovery lookups. We do not store your raw email on our servers.</li>
<li><strong>License key blob</strong> — the signed license key PEM that was delivered to you. It contains your name and email inside a cryptographic envelope.</li>
<li><strong>Stripe session ID and charge ID</strong> — for payment reconciliation, refund processing, and dispute handling.</li>
<li><strong>License metadata</strong> — license ID, status, issued/updated timestamps.</li>
</ul>

<h2>What We Do Not Collect</h2>
<ul>
<li>We do not store your raw email address or name on our servers outside the license key blob.</li>
<li>We do not collect analytics, telemetry, or usage data from the Lit desktop app.</li>
<li>We do not use cookies or tracking scripts on our website.</li>
<li>Payment details (card number, billing address) are handled entirely by Stripe and never touch our servers.</li>
</ul>

<h2>How Your Data Is Used</h2>
<ul>
<li><strong>License delivery:</strong> Your email is used at purchase time to send the license key, then only the hash is retained.</li>
<li><strong>License recovery:</strong> If you lose your license key, you can request re-delivery by providing your email. We hash it and look up the matching record.</li>
<li><strong>Revocation checks:</strong> The Lit app performs a daily online check (license ID only, no PII) to verify the license has not been revoked. This check is skipped gracefully if you are offline.</li>
</ul>

<h2>Data Retention</h2>
<p>License records are retained indefinitely for the purpose of license recovery and revocation verification. If you request deletion, the record is permanently destroyed.</p>

<h2>Your Rights</h2>
<p>You may request deletion of all data associated with your license at any time. Upon deletion:</p>
<ul>
<li>Your DynamoDB record (email hash, license key blob, Stripe IDs) is permanently deleted.</li>
<li>Your license will no longer pass online validation checks.</li>
<li>This action is irreversible — you will need to purchase a new license afterward.</li>
</ul>
<p>To request deletion, email <a href="mailto:privacy@lit.solar">privacy@lit.solar</a> from the email address associated with your license.</p>

<h2>Third Parties</h2>
<ul>
<li><strong>Stripe</strong> — payment processing. Subject to <a href="https://stripe.com/privacy">Stripe's privacy policy</a>.</li>
<li><strong>AWS</strong> — infrastructure (Lambda, DynamoDB, SES). Data is processed in the US.</li>
</ul>

<h2>Changes</h2>
<p>We may update this policy. Changes will be posted at this URL. Continued use of Lit after changes constitutes acceptance.</p>

<h2>Contact</h2>
<p>For privacy inquiries or deletion requests: <a href="mailto:privacy@lit.solar">privacy@lit.solar</a></p>
</body></html>`;
}
