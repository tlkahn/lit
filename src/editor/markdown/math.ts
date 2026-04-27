import type { MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

export const Math: MarkdownConfig = {
  defineNodes: [
    { name: "InlineMath", style: tags.emphasis },
    { name: "InlineMathMark", style: tags.processingInstruction },
    { name: "DisplayMath", block: true, style: tags.emphasis },
  ],
  parseInline: [
    {
      name: "InlineMath",
      after: "Escape",
      parse(cx, next, pos) {
        if (next !== 36) return -1;
        if (cx.char(pos + 1) === 36) return -1;
        let end = pos + 1;
        while (end < cx.end) {
          const ch = cx.char(end);
          if (ch === 10 || ch === 13 || ch === -1) return -1;
          if (ch === 36) {
            const closeEnd = end + 1;
            return cx.addElement(
              cx.elt("InlineMath", pos, closeEnd, [
                cx.elt("InlineMathMark", pos, pos + 1),
                cx.elt("InlineMathMark", end, closeEnd),
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
      name: "DisplayMath",
      before: "HorizontalRule",
      parse(cx, line) {
        if (!/^\$\$/.test(line.text)) return false;

        const start = cx.lineStart;

        const closeIdx = line.text.indexOf("$$", 2);
        if (closeIdx > 2) {
          const afterClose = line.text.slice(closeIdx + 2).trim();
          if (afterClose === "" || /^\{#[a-z]+:[^}]+\}$/.test(afterClose)) {
            const end = cx.lineStart + closeIdx + 2;
            cx.nextLine();
            cx.addElement(cx.elt("DisplayMath", start, end));
            return true;
          }
        }

        let lastEnd = cx.lineStart + line.text.length;
        while (cx.nextLine()) {
          if (/^\$\$\s*(\{#[a-z]+:[^}]+\})?\s*$/.test(line.text)) {
            const end = cx.lineStart + 2;
            cx.nextLine();
            cx.addElement(cx.elt("DisplayMath", start, end));
            return true;
          }
          lastEnd = cx.lineStart + line.text.length;
        }

        cx.addElement(cx.elt("DisplayMath", start, lastEnd));
        return true;
      },
    },
  ],
};
