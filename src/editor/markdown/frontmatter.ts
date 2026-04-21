import type { MarkdownConfig } from "@lezer/markdown";

export const Frontmatter: MarkdownConfig = {
  defineNodes: [{ name: "Frontmatter", block: true }],
  parseBlock: [
    {
      name: "Frontmatter",
      before: "HorizontalRule",
      parse(cx, line) {
        if (cx.lineStart !== 0) return false;
        if (!/^-{3,}\s*$/.test(line.text)) return false;

        const start = cx.lineStart;
        let lastEnd = cx.lineStart + line.text.length;

        while (cx.nextLine()) {
          if (/^-{3,}\s*$/.test(line.text)) {
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt("Frontmatter", start, end));
            return true;
          }
          lastEnd = cx.lineStart + line.text.length;
        }

        cx.addElement(cx.elt("Frontmatter", start, lastEnd));
        return true;
      },
    },
  ],
};
