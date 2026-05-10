export function cancelPageHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Purchase Cancelled — Lit</title></head><body>
<h1>Purchase Cancelled</h1>
<p>Your purchase has been cancelled. No charges were made.</p>
<p>If you'd like to try again, visit <a href="https://lit.solar">lit.solar</a>.</p>
<hr>
<p><a href="/privacy">Privacy Policy</a> · <a href="/refund">Refund Policy</a></p>
</body></html>`;
}
