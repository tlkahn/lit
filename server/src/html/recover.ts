import { pageHtml } from "./layout.js";

export function recoverPageHtml(): string {
  return pageHtml("Recover License — Lit", `\
<h1>Recover Your License</h1>
<form action="/api/recover" method="POST">
<label for="email">Email address:</label>
<input id="email" name="email" type="email" required />
<button type="submit">Recover</button>
</form>`);
}

export function recoverResultPageHtml(): string {
  return pageHtml("Recovery Submitted — Lit", `\
<h1>Recovery Submitted</h1>
<p>If an account exists for that address, please check your email for your license key.</p>`);
}
