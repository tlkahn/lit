const CSS = `
:root {
  --color-bg: #FFFFFF;
  --color-text: #1D1D1F;
  --color-secondary: #6E6E73;
  --color-accent: #0071E3;
  --color-accent-hover: #0060C0;
  --color-rule: #D2D2D7;
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --content-width: 720px;
}
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0; padding: 0;
  font-family: var(--font-sans);
  font-size: 18px;
  line-height: 1.6;
  color: var(--color-text);
  background: var(--color-bg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.container {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 80px 24px;
}
h1 { font-size: 40px; font-weight: 600; margin: 0 0 24px; line-height: 1.2; }
h2 { font-size: 24px; font-weight: 600; margin: 48px 0 16px; line-height: 1.3; }
p { margin: 0 0 16px; }
a { color: var(--color-accent); text-decoration: none; }
a:hover { text-decoration: underline; }
ul { list-style: disc; padding-left: 24px; margin: 0 0 16px; }
li { margin-bottom: 8px; }
button, .cta {
  display: inline-block;
  background: var(--color-accent);
  color: #fff;
  border: none;
  padding: 14px 36px;
  font-size: 16px;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  text-decoration: none;
  font-family: var(--font-sans);
}
button:hover, .cta:hover { background: var(--color-accent-hover); text-decoration: none; }
input[type="email"] {
  display: block;
  width: 100%;
  max-width: 400px;
  padding: 12px 16px;
  font-size: 16px;
  font-family: var(--font-sans);
  border: 1px solid var(--color-rule);
  border-radius: 0;
  margin: 8px 0 16px;
  outline: none;
}
input[type="email"]:focus { border-color: var(--color-accent); }
pre {
  background: #F5F5F7;
  padding: 16px 20px;
  border: 1px solid var(--color-rule);
  border-radius: 4px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 14px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0 0 16px;
}
hr {
  border: none;
  border-top: 1px solid var(--color-rule);
  margin: 48px 0 24px;
}
.footer { color: var(--color-secondary); font-size: 14px; }
label { display: block; font-size: 16px; font-weight: 600; }
@media (max-width: 600px) {
  .container { padding: 40px 20px; }
  h1 { font-size: 28px; }
  h2 { font-size: 20px; }
}`;

export function pageHtml(
  title: string,
  body: string,
  headExtra?: string,
): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>${CSS}</style>${headExtra ? "\n" + headExtra : ""}
</head><body>
<div class="container">
${body}
</div>
</body></html>`;
}
