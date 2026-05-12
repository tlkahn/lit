import { pageHtml } from "./layout.js";

export function errorPageHtml(): string {
  return pageHtml("Error — Lit", `\
<h1>Something Went Wrong</h1>
<p>An unexpected error occurred. Please try again later.</p>`);
}
