const STYLE_ID = "lit-custom-theme";

export function injectThemeCss(css: string): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

export function clearThemeCss(): void {
  const el = document.getElementById(STYLE_ID);
  if (el) {
    el.textContent = "";
  }
}
