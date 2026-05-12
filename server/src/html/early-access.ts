import { pageHtml } from "./layout.js";

export function earlyAccessFormHtml(): string {
  return pageHtml("Early Access — Lit", `\
<h1>Early Access</h1>
<p>Claim your free license as an early adopter.</p>
<form action="/api/early-access" method="POST">
<label for="email">Email address:</label>
<input id="email" name="email" type="email" required />
<button type="submit">Claim License</button>
</form>
<hr>
<p class="footer"><a href="/privacy">Privacy Policy</a> · <a href="/refund">Refund Policy</a></p>`);
}

export function earlyAccessConfirmationHtml(): string {
  return pageHtml("Early Access — Lit", `\
<h1>Thank You</h1>
<p>If you are eligible, please check your email for your license key.</p>`);
}

export function earlyAccessClosedHtml(): string {
  return pageHtml("Early Access Closed — Lit", `\
<h1>Early Access Closed</h1>
<p>The early-access period has ended. Please visit our website to purchase a license.</p>`);
}
