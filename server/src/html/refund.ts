export function refundPageHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Refund Policy — Lit</title></head><body>
<h1>Refund Policy</h1>
<p><strong>Operator:</strong> Lit Solar Software LLC, Delaware, USA</p>

<h2>14-Day Money-Back Guarantee</h2>
<p>If you are not satisfied with Lit, you may request a full refund within 14 days of purchase. No questions asked.</p>

<h2>How to Request a Refund</h2>
<p>Email <a href="mailto:privacy@lit.solar">privacy@lit.solar</a> from the email address you used to purchase, with the subject line "Refund request". Include your license ID if you have it (not required).</p>
<p>Refunds are typically processed within 3–5 business days. The refund will appear on the original payment method used at checkout.</p>

<h2>What Happens After a Refund</h2>
<ul>
<li>Your license is revoked immediately upon refund processing.</li>
<li>The Lit app will detect the revocation on its next online validation check and return to the trial-expired state.</li>
<li>You may continue to export your data at any time, even after revocation.</li>
</ul>

<h2>Disputes and Chargebacks</h2>
<p>If you file a chargeback with your bank instead of requesting a refund, your license will also be revoked. We encourage you to contact us first — we are happy to issue a refund directly.</p>

<h2>After 14 Days</h2>
<p>Refund requests made after the 14-day window are handled on a case-by-case basis. Contact us and we will do our best to help.</p>

<h2>Contact</h2>
<p><a href="mailto:privacy@lit.solar">privacy@lit.solar</a></p>
</body></html>`;
}
