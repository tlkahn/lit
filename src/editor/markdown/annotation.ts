import type { MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

export const Annotation: MarkdownConfig = {
  defineNodes: [
    { name: "InlineAnnotation", style: tags.meta },
    { name: "InlineAnnotationMark", style: tags.processingInstruction },
    { name: "BlockAnnotation", block: true, style: tags.meta },
  ],
  parseInline: [
    {
      name: "InlineAnnotation",
      before: "HTMLTag",
      parse(cx, next, pos) {
        // <!--- — char codes: 60 33 45 45 45
        if (next !== 60) return -1;
        if (cx.char(pos + 1) !== 33) return -1;
        if (cx.char(pos + 2) !== 45) return -1;
        if (cx.char(pos + 3) !== 45) return -1;
        if (cx.char(pos + 4) !== 45) return -1;
        let end = pos + 5;
        while (end < cx.end) {
          const ch = cx.char(end);
          if (ch === 10 || ch === 13 || ch === -1) return -1;
          // ---> — char codes: 45 45 45 62
          if (ch === 45 && cx.char(end + 1) === 45 && cx.char(end + 2) === 45 && cx.char(end + 3) === 62) {
            const closeEnd = end + 4;
            return cx.addElement(
              cx.elt("InlineAnnotation", pos, closeEnd, [
                cx.elt("InlineAnnotationMark", pos, pos + 5),
                cx.elt("InlineAnnotationMark", end, closeEnd),
              ]),
            );
          }
          end++;
        }
        return -1;
      },
    },
  ],
  parseBlock: [
    {
      name: "BlockAnnotation",
      before: "HTMLBlock",
      endLeaf(_cx, line) {
        if (!/^<!---/.test(line.text)) return false;
        if (line.text.indexOf("--->", 5) !== -1) return false;
        return true;
      },
      parse(cx, line) {
        if (!/^<!---/.test(line.text)) return false;

        const start = cx.lineStart;

        // Single-line: check if ---> appears anywhere after the opening <!---
        const closeIdx = line.text.indexOf("--->", 5);
        if (closeIdx !== -1) {
          const end = cx.lineStart + closeIdx + 4;
          cx.nextLine();
          cx.addElement(cx.elt("BlockAnnotation", start, end));
          return true;
        }

        // Multi-line: <!---\n...\n--->
        let lastEnd = cx.lineStart + line.text.length;
        while (cx.nextLine()) {
          if (/^--->\s*$/.test(line.text)) {
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt("BlockAnnotation", start, end));
            return true;
          }
          lastEnd = cx.lineStart + line.text.length;
        }

        // Unclosed — graceful degradation
        cx.addElement(cx.elt("BlockAnnotation", start, lastEnd));
        return true;
      },
    },
  ],
};
