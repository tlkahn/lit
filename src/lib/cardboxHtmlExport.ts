import type { CardboxAnnotation } from "./ipc";
import { escapeHtml } from "./escapeHtml";
import { renderMarkdown, renderInlineMarkdown } from "./renderMarkdown";
import { KATEX_INLINE_CSS } from "./katexInlineCss";

const BASE_CSS = `
:root {
  --card-h: 320px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: #f5f5f5;
  color: #1a1a1a;
  padding: 2rem;
  line-height: 1.6;
}

.page-header {
  text-align: center;
  margin-bottom: 2rem;
}

.page-header h1 {
  font-size: 1.5rem;
  font-weight: 600;
  color: #333;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;
  max-width: 1200px;
  margin: 0 auto;
}

.card {
  position: relative;
  height: var(--card-h);
  perspective: 800px;
}

.flip-toggle {
  display: none;
}

.card-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  transition: transform 0.5s ease;
}

.flip-toggle:checked ~ .card-inner {
  transform: rotateY(180deg);
}

.face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.06);
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
}

.face--back {
  transform: rotateY(180deg);
}

.face-scroll {
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.face-scroll p {
  margin-bottom: 0.75em;
}

.face-scroll pre {
  overflow-x: auto;
  background: #f8f8f8;
  padding: 0.75em;
  border-radius: 4px;
  margin-bottom: 0.75em;
}

.face-scroll code {
  font-size: 0.9em;
}

.face-scroll blockquote {
  border-left: 3px solid #ddd;
  padding-left: 1em;
  color: #555;
  margin-bottom: 0.75em;
}

.flip-btn {
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.05);
  transition: background 0.15s;
}

.flip-btn:hover {
  background: rgba(0, 0, 0, 0.1);
}

.flip-btn::after {
  content: "\\21BB";
  font-size: 16px;
  color: #666;
}

.card--single .face {
  position: relative;
}
`;

function renderCard(c: CardboxAnnotation, index: number): string {
  const canFlip = Boolean(c.original);
  const frontHtml = renderMarkdown(c.body ?? "");
  const id = `c${index}`;

  if (!canFlip) {
    return `<section class="card card--single">
  <div class="card-inner">
    <div class="face face--front"><div class="face-scroll">${frontHtml}</div></div>
  </div>
</section>`;
  }

  const backHtml = renderInlineMarkdown(c.original!);
  return `<section class="card card--flippable">
  <input type="checkbox" id="${id}" class="flip-toggle" hidden>
  <div class="card-inner">
    <div class="face face--front"><div class="face-scroll">${frontHtml}</div><label class="flip-btn" for="${id}" aria-label="Flip card"></label></div>
    <div class="face face--back"><div class="face-scroll">${backHtml}</div><label class="flip-btn" for="${id}" aria-label="Flip card"></label></div>
  </div>
</section>`;
}

export function renderCardboxHtml(
  cards: CardboxAnnotation[],
  opts: { title: string; katexCss?: string },
): string {
  const title = escapeHtml(opts.title);
  const renderedCards = cards.map((c, i) => renderCard(c, i));
  const joinedCards = renderedCards.join("\n");

  const hasMath = renderedCards.some((html) =>
    html.includes("cm-preview-math"),
  );
  const katexBlock =
    hasMath ? (opts.katexCss ?? KATEX_INLINE_CSS) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${BASE_CSS}
${katexBlock}
</style>
</head>
<body>
<header class="page-header"><h1>${title}</h1></header>
<main class="cards">
${joinedCards}
</main>
</body>
</html>`;
}
