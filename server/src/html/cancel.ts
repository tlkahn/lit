export function cancelPageHtml(): string {
  return `<html><body>
<h1>Purchase Cancelled</h1>
<p>Your purchase has been cancelled. No charges were made.</p>
<p>If you'd like to try again, visit <a href="https://lit.solar">lit.solar</a>.</p>
</body></html>`;
}
