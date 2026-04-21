import type { MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

export const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: "WikiLink", style: tags.link },
    { name: "WikiLinkMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== 91) return -1;
        if (cx.char(pos + 1) !== 91) return -1;
        let end = pos + 2;
        while (end < cx.end) {
          const ch = cx.char(end);
          if (ch === 10 || ch === 13 || ch === -1) return -1;
          if (ch === 93 && cx.char(end + 1) === 93) {
            const closeEnd = end + 2;
            return cx.addElement(
              cx.elt("WikiLink", pos, closeEnd, [
                cx.elt("WikiLinkMark", pos, pos + 2),
                cx.elt("WikiLinkMark", end, closeEnd),
              ]),
            );
          }
          end++;
        }
        return -1;
      },
    },
  ],
};
