export function earlyAccessFormHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Early Access — Lit</title></head><body>
<h1>Early Access</h1>
<p>Claim your free license as an early adopter.</p>
<form action="/api/early-access" method="POST">
<label for="email">Email address:</label>
<input id="email" name="email" type="email" required />
<button type="submit">Claim License</button>
</form>
<hr>
<p><a href="/privacy">Privacy Policy</a> · <a href="/refund">Refund Policy</a></p>
</body></html>`;
}

export function earlyAccessConfirmationHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Early Access — Lit</title></head><body>
<h1>Thank You</h1>
<p>If you are eligible, please check your email for your license key.</p>
</body></html>`;
}

export function earlyAccessClosedHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Early Access Closed — Lit</title></head><body>
<h1>Early Access Closed</h1>
<p>The early-access period has ended. Please visit our website to purchase a license.</p>
</body></html>`;
}
