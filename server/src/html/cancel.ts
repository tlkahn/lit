import { pageHtml } from "./layout.js";

export function cancelPageHtml(): string {
  return pageHtml("Purchase Cancelled — Lit", `\
<h1>Purchase Cancelled</h1>
<p>Your purchase has been cancelled. No charges were made.</p>
<p>If you'd like to try again, visit <a href="https://lit.solar">lit.solar</a>.</p>
<hr>
<p class="footer"><a href="/privacy">Privacy Policy</a> · <a href="/refund">Refund Policy</a></p>`);
}
