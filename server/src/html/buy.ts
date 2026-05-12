export function buyPageHtml(turnstileSiteKey?: string): string {
  const turnstileSnippet = turnstileSiteKey
    ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<div class="cf-turnstile" data-sitekey="${turnstileSiteKey}"></div>`
    : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Buy Lit</title></head><body>
<h1>Lit</h1>
<p>Local-first notetaker and knowledge graph manager.</p>
<form action="/api/checkout" method="POST">
${turnstileSnippet}
<button type="submit">Buy — $29</button>
</form>
<p><a href="/privacy">Privacy Policy</a> · <a href="/refund">Refund Policy</a></p>
</body></html>`;
}
