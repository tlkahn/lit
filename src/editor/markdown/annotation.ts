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
      before: "InlineComment",
      parse(cx, next, pos) {
        // %%! — char codes: 37 37 33
        if (next !== 37) return -1;
        if (cx.char(pos + 1) !== 37) return -1;
        if (cx.char(pos + 2) !== 33) return -1;
        let end = pos + 3;
        while (end < cx.end) {
          const ch = cx.char(end);
          if (ch === 10 || ch === 13 || ch === -1) return -1;
          if (ch === 37 && cx.char(end + 1) === 37) {
            const closeEnd = end + 2;
            return cx.addElement(
              cx.elt("InlineAnnotation", pos, closeEnd, [
                cx.elt("InlineAnnotationMark", pos, pos + 3),
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
      before: "BlockComment",
      parse(cx, line) {
        if (!/^%%!/.test(line.text)) return false;

        const start = cx.lineStart;

        // Single-line: %%!content%%
        if (line.text.length > 3 && line.text.endsWith("%%")) {
          const end = cx.lineStart + line.text.length;
          cx.nextLine();
          cx.addElement(cx.elt("BlockAnnotation", start, end));
          return true;
        }

        // Multi-line: %%!\n...\n%%
        let lastEnd = cx.lineStart + line.text.length;
        while (cx.nextLine()) {
          if (/^%%\s*$/.test(line.text)) {
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
