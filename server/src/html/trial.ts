import { escapeHtml } from "../email/templates.js";
import { pageHtml } from "./layout.js";

export function trialFormHtml(turnstileSiteKey?: string): string {
  const headExtra = turnstileSiteKey
    ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
    : undefined;

  const turnstileWidget = turnstileSiteKey
    ? `<div id="turnstile-widget" class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" data-callback="onTurnstileSuccess"></div>
<script>function onTurnstileSuccess(){document.getElementById("trial-btn").style.display="";document.getElementById("turnstile-widget").style.display="none"}</script>`
    : "";

  const buttonStyle = turnstileSiteKey ? ' style="display:none"' : "";

  return pageHtml("Free Trial — Lit", `\
<h1>Free Trial</h1>
<p>Try Lit free for 7 days. Enter your email to receive a trial license key.</p>
<form action="/api/trial" method="POST">
<label for="email">Email address:</label>
<input id="email" name="email" type="email" required />${turnstileWidget ? "\n" + turnstileWidget : ""}
<button id="trial-btn"${buttonStyle} type="submit">Start Free Trial</button>
</form>
<hr>
<p class="footer"><a href="/privacy">Privacy Policy</a> · <a href="/refund">Refund Policy</a></p>`, headExtra);
}

export function trialConfirmationHtml(): string {
  return pageHtml("Free Trial — Lit", `\
<h1>Thank You</h1>
<p>Please check your email for your trial license key.</p>`);
}
