import type { MarkdownConfig } from "@lezer/markdown";
import { parseMixed } from "@lezer/common";
import { yamlLanguage } from "@codemirror/lang-yaml";

export const FrontmatterYamlWrap: MarkdownConfig = {
  wrap: parseMixed((node, input) => {
    if (node.type.name !== "Frontmatter") return null;
    const text = input.read(node.from, node.to);
    const openEnd = text.indexOf("\n") + 1;
    const closeStart = text.lastIndexOf("\n---");
    if (closeStart <= 0 || node.from + openEnd >= node.from + closeStart) return null;
    return {
      parser: yamlLanguage.parser,
      overlay: [{ from: node.from + openEnd, to: node.from + closeStart }],
    };
  }),
};

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
