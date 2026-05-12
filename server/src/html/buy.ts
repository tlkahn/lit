import { escapeHtml } from "../email/templates.js";
import { pageHtml } from "./layout.js";

export function buyPageHtml(turnstileSiteKey?: string): string {
  const headExtra = turnstileSiteKey
    ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
    : undefined;

  const turnstileWidget = turnstileSiteKey
    ? `<div id="turnstile-widget" class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" data-callback="onTurnstileSuccess"></div>
<script>function onTurnstileSuccess(){document.getElementById("buy-btn").style.display="";document.getElementById("turnstile-widget").style.display="none"}</script>`
    : "";

  const buttonStyle = turnstileSiteKey ? ' style="display:none"' : "";

  return pageHtml("Buy Lit", `\
<h1>Lit</h1>
<p>Local-first notetaker and knowledge graph manager.</p>
<form action="/api/checkout" method="POST">
${turnstileWidget}
<button id="buy-btn"${buttonStyle} type="submit">Buy — $29</button>
</form>
<p class="footer"><a href="/privacy">Privacy Policy</a> · <a href="/refund">Refund Policy</a></p>`, headExtra);
}
