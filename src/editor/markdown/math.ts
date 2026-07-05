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
      before: "Escape",
      parse(cx, next, pos) {
        // Two delimiter styles: $...$ (openSize 1) and \(...\) (openSize 2)
        let openSize: number;
        if (next === 36) {
          if (cx.char(pos + 1) === 36) return -1;
          openSize = 1;
        } else if (next === 92 && cx.char(pos + 1) === 40) {
          openSize = 2;
        } else {
          return -1;
        }
        let end = pos + openSize;
        while (end < cx.end) {
          const ch = cx.char(end);
          if (ch === 10 || ch === 13 || ch === -1) return -1;
          const closes =
            openSize === 1
              ? ch === 36
              : ch === 92 && cx.char(end + 1) === 41;
          if (closes) {
            const closeEnd = end + openSize;
            return cx.addElement(
              cx.elt("InlineMath", pos, closeEnd, [
                cx.elt("InlineMathMark", pos, pos + openSize),
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
        let close: string;
        if (/^\$\$/.test(line.text)) close = "$$";
        else if (/^\\\[/.test(line.text)) close = "\\]";
        else return false;

        const start = cx.lineStart;

        const closeIdx = line.text.indexOf(close, 2);
        if (closeIdx > 2) {
          const afterClose = line.text.slice(closeIdx + 2).trim();
          if (afterClose === "" || /^\{#[a-z]+:[^}]+\}$/.test(afterClose)) {
            const end = cx.lineStart + closeIdx + 2;
            cx.nextLine();
            cx.addElement(cx.elt("DisplayMath", start, end));
            return true;
          }
        }

        // $$ closes only on its own line; \] closes any line it ends
        const closeRe =
          close === "$$"
            ? /^\$\$\s*(\{#[a-z]+:[^}]+\})?\s*$/
            : /\\\]\s*(\{#[a-z]+:[^}]+\})?\s*$/;
        let lastEnd = cx.lineStart + line.text.length;
        while (cx.nextLine()) {
          const m = closeRe.exec(line.text);
          if (m) {
            const end = cx.lineStart + m.index + 2;
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
