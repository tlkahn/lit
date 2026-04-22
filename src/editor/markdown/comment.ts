import type { MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

export const Comment: MarkdownConfig = {
  defineNodes: [
    { name: "InlineComment", style: tags.comment },
    { name: "InlineCommentMark", style: tags.processingInstruction },
    { name: "BlockComment", block: true, style: tags.comment },
  ],
  parseInline: [
    {
      name: "InlineComment",
      after: "Escape",
      parse(cx, next, pos) {
        if (next !== 37) return -1;
        if (cx.char(pos + 1) !== 37) return -1;
        let end = pos + 2;
        while (end < cx.end) {
          const ch = cx.char(end);
          if (ch === 10 || ch === 13 || ch === -1) return -1;
          if (ch === 37 && cx.char(end + 1) === 37) {
            const closeEnd = end + 2;
            return cx.addElement(
              cx.elt("InlineComment", pos, closeEnd, [
                cx.elt("InlineCommentMark", pos, pos + 2),
                cx.elt("InlineCommentMark", end, closeEnd),
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
      name: "BlockComment",
      before: "HorizontalRule",
      parse(cx, line) {
        if (!/^%%/.test(line.text)) return false;

        const start = cx.lineStart;

        if (line.text.length > 2 && line.text.endsWith("%%")) {
          const end = cx.lineStart + line.text.length;
          cx.nextLine();
          cx.addElement(cx.elt("BlockComment", start, end));
          return true;
        }

        let lastEnd = cx.lineStart + line.text.length;
        while (cx.nextLine()) {
          if (/^%%\s*$/.test(line.text)) {
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt("BlockComment", start, end));
            return true;
          }
          lastEnd = cx.lineStart + line.text.length;
        }

        cx.addElement(cx.elt("BlockComment", start, lastEnd));
        return true;
      },
    },
  ],
};
