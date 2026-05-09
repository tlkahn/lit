export function recoverPageHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Recover License — Lit</title></head><body>
<h1>Recover Your License</h1>
<form action="/api/recover" method="POST">
<label for="email">Email address:</label>
<input id="email" name="email" type="email" required />
<button type="submit">Recover</button>
</form>
</body></html>`;
}

export function recoverResultPageHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Recovery Submitted — Lit</title></head><body>
<h1>Recovery Submitted</h1>
<p>If an account exists for that address, please check your email for your license key.</p>
</body></html>`;
}
