const SENTENCES = [
  "The quick brown fox jumps over the lazy dog.",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.",
  "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia.",
  "Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.",
  "Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet.",
  "At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis.",
  "Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit.",
];

function sentence(i: number): string {
  return SENTENCES[i % SENTENCES.length]!;
}

export function generateProse(lines: number): string {
  const out: string[] = [];
  let heading = 1;
  let lineNum = 0;

  while (lineNum < lines) {
    out.push(`${"#".repeat(((heading - 1) % 6) + 1)} Section ${heading}`);
    heading++;
    lineNum++;
    if (lineNum >= lines) break;

    for (let j = 0; j < 3 && lineNum < lines; j++) {
      out.push(sentence(lineNum));
      lineNum++;
    }
    if (lineNum >= lines) break;
    out.push("");
    lineNum++;

    for (let j = 0; j < 3 && lineNum < lines; j++) {
      out.push(`- ${sentence(lineNum)}`);
      lineNum++;
    }
    if (lineNum >= lines) break;
    out.push("");
    lineNum++;

    for (let j = 0; j < 3 && lineNum < lines; j++) {
      out.push(`${j + 1}. ${sentence(lineNum)}`);
      lineNum++;
    }
    if (lineNum >= lines) break;
    out.push("");
    lineNum++;
  }

  return out.join("\n");
}

export function generateDecorationHeavy(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    switch (i % 6) {
      case 0: out.push(`**bold text** and *italic text* on line ${i}`); break;
      case 1: out.push(`[link text](https://example.com/${i}) and [[WikiPage${i}]]`); break;
      case 2: out.push(`$E=mc^{${i}}$ and \`inline code ${i}\``); break;
      case 3: out.push(`**strong ${i}** *em ${i}* [ref](https://url.com/${i})`); break;
      case 4: out.push(`[[Note ${i}|display ${i}]] and $\\alpha_{${i}}$`); break;
      case 5: out.push(`\`code${i}\` **b${i}** *i${i}* [[W${i}]] $x^{${i}}$`); break;
    }
  }
  return out.join("\n");
}

export function generateWidgetHeavy(lines: number): string {
  const out: string[] = [];
  let lineNum = 0;
  let block = 0;

  while (lineNum < lines) {
    switch (block % 4) {
      case 0:
        out.push("| Col A | Col B | Col C |");
        out.push("| --- | --- | --- |");
        out.push(`| cell ${lineNum} | data | value |`);
        out.push(`| cell ${lineNum + 1} | data | value |`);
        lineNum += 4;
        break;
      case 1:
        out.push("$$");
        out.push(`\\sum_{i=0}^{${block}} x_i^2 + y_i^2`);
        out.push("$$");
        lineNum += 3;
        break;
      case 2:
        out.push("```mermaid");
        out.push(`graph LR; A${block}-->B${block}`);
        out.push(`    B${block}-->C${block}`);
        out.push("```");
        lineNum += 4;
        break;
      case 3:
        out.push(`> [!note] Note ${block}`);
        out.push(`> ${sentence(lineNum)}`);
        out.push(`> ${sentence(lineNum + 1)}`);
        lineNum += 3;
        break;
    }
    block++;

    if (lineNum < lines) {
      out.push("");
      lineNum++;
    }
  }

  return out.join("\n");
}

export function generateDeeplyNested(lines: number): string {
  const out: string[] = [];
  const maxDepth = 10;
  let lineNum = 0;

  while (lineNum < lines) {
    for (let depth = 0; depth < maxDepth && lineNum < lines; depth++) {
      out.push(`${"  ".repeat(depth)}- Level ${depth}: ${sentence(lineNum)}`);
      lineNum++;
    }
    for (let depth = maxDepth - 2; depth >= 0 && lineNum < lines; depth--) {
      out.push(`${"  ".repeat(depth)}- Back ${depth}: ${sentence(lineNum)}`);
      lineNum++;
    }
    if (lineNum >= lines) break;
    out.push("");
    lineNum++;

    const quoteDepth = Math.min(6, Math.ceil((lines - lineNum) / 2));
    for (let depth = 1; depth <= quoteDepth && lineNum < lines; depth++) {
      out.push(`${"> ".repeat(depth)}${sentence(lineNum)}`);
      lineNum++;
    }
    if (lineNum >= lines) break;
    out.push("");
    lineNum++;
  }

  return out.join("\n");
}

/**
 * Annotation-heavy fixture: one inline annotation per line.
 *
 * Each line has text BEFORE the `<!---...--->` marker so the parser emits an
 * `InlineAnnotation` (line-safe, ViewPlugin-rendered) rather than a
 * `BlockAnnotation`. The annotation body varies per line so original text is
 * distinct. `generateAnnotationHeavy(250)` yields 250 annotations.
 */
export function generateAnnotationHeavy(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    out.push(`Line ${i}: ${sentence(i)} <!---note ${i}---> tail text`);
  }
  return out.join("\n");
}
