import type { MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

export const Footnote: MarkdownConfig = {
  defineNodes: [
    { name: "FootnoteRef", style: tags.link },
    { name: "FootnoteRefMark", style: tags.processingInstruction },
    // No style on FootnoteDef: the body must NOT paint as .tok-link
    // (accent + underline) when the raw source is revealed by the caret.
    // Only the FootnoteDefMark child carries chrome (processingInstruction).
    { name: "FootnoteDef", block: true },
    { name: "FootnoteDefMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "FootnoteRef",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== 91) return -1; // [
        if (cx.char(pos + 1) !== 94) return -1; // ^
        let end = pos + 2;
        const idStart = end;
        while (end < cx.end) {
          const ch = cx.char(end);
          if (ch === 10 || ch === 13 || ch === -1) return -1;
          if (ch === 93) { // ]
            if (end === idStart) return -1;
            const closeEnd = end + 1;
            return cx.addElement(
              cx.elt("FootnoteRef", pos, closeEnd, [
                cx.elt("FootnoteRefMark", pos, pos + 2),
                cx.elt("FootnoteRefMark", end, closeEnd),
              ]),
            );
          }
          // Validate identifier chars: [a-zA-Z0-9_-]
          if (
            !(ch >= 48 && ch <= 57) && // 0-9
            !(ch >= 65 && ch <= 90) && // A-Z
            !(ch >= 97 && ch <= 122) && // a-z
            ch !== 45 && // -
            ch !== 95 // _
          ) {
            return -1;
          }
          end++;
        }
        return -1;
      },
    },
  ],
  parseBlock: [
    {
      name: "FootnoteDef",
      before: "LinkReference",
      parse(cx, line) {
        const match = /^\[\^[a-zA-Z0-9_-]+\]:/.exec(line.text);
        if (!match) return false;

        const start = cx.lineStart;
        let lastEnd = cx.lineStart + line.text.length;

        while (cx.nextLine()) {
          if (line.text.length === 0) break;
          if (line.text.charCodeAt(0) !== 9 && !line.text.startsWith("    ")) break;
          lastEnd = cx.lineStart + line.text.length;
        }

        const markEnd = start + match[0].length;
        cx.addElement(
          cx.elt("FootnoteDef", start, lastEnd, [
            cx.elt("FootnoteDefMark", start, markEnd),
          ]),
        );
        return true;
      },
    },
  ],
};
