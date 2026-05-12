import { escapeHtml } from "../email/templates.js";

export function buyPageHtml(turnstileSiteKey?: string): string {
  const turnstileSnippet = turnstileSiteKey
    ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" data-callback="onTurnstileSuccess"></div>
<script>function onTurnstileSuccess(){document.getElementById("buy-btn").style.display=""}</script>`
    : "";

  const buttonStyle = turnstileSiteKey ? ' style="display:none"' : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Buy Lit</title></head><body>
<h1>Lit</h1>
<p>Local-first notetaker and knowledge graph manager.</p>
<form action="/api/checkout" method="POST">
${turnstileSnippet}
<button id="buy-btn"${buttonStyle} type="submit">Buy — $29</button>
</form>
<p><a href="/privacy">Privacy Policy</a> · <a href="/refund">Refund Policy</a></p>
</body></html>`;
}
