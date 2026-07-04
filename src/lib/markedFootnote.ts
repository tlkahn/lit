// GFM footnote extension for marked, adapted from marked-footnote
// (https://github.com/bent10/marked-extensions/tree/main/packages/footnote, MIT).
// Simplified for lit: numbered markers only, no heading/divider in the footnotes
// section, and a per-render unique id prefix so multiple rendered bodies can
// coexist in the same document without duplicate element ids.
import type { MarkedExtension, Token, Tokens } from "marked";

type Footnotes = {
  type: "footnotes";
  raw: string;
  rawItems: Footnote[];
  items: Footnote[];
};

type Footnote = {
  type: "footnote";
  raw: string;
  label: string;
  refs: FootnoteRef[];
  content: Token[];
};

type FootnoteRef = {
  type: "footnoteRef";
  raw: string;
  index: number;
  id: string;
  label: string;
};

let renderCounter = 0;

export function litFootnoteExtension(): MarkedExtension {
  const lexer: { hasFootnotes: boolean; tokens: Token[] } = {
    hasFootnotes: false,
    tokens: [],
  };
  const footnotes: Footnotes = {
    type: "footnotes",
    raw: "Footnotes",
    rawItems: [],
    items: [],
  };
  // Read at render time, not baked into the renderers, so each parse gets a
  // fresh prefix and ref numbering.
  const state = { prefix: "fn-0-", order: 0 };

  return {
    hooks: {
      preprocess(markdown: string): string {
        renderCounter++;
        state.prefix = `fn-${renderCounter}-`;
        state.order = 0;
        lexer.hasFootnotes = false;
        lexer.tokens = [];
        footnotes.rawItems = [];
        footnotes.items = [];
        return markdown;
      },
    },
    extensions: [
      {
        name: "footnote",
        level: "block",
        childTokens: ["content"],
        tokenizer(src: string): Footnote | undefined {
          if (!lexer.hasFootnotes) {
            // Runs on the very first block tokenization attempt, so the
            // footnotes token always lands at index 0; walkTokens moves it
            // to the end once lexing is complete.
            this.lexer.tokens.push(footnotes as unknown as Token);
            lexer.tokens = this.lexer.tokens;
            lexer.hasFootnotes = true;
          }

          const match =
            /^\[\^([^\]\n]+)\]:(?:[ \t]+|[\n]*?|$)([^\n]*?(?:\n|$)(?:\n*?[ ]{4,}[^\n]*)*)/.exec(
              src,
            );
          if (!match) return;

          const raw = match[0];
          const label = match[1]!;
          const text = match[2] ?? "";
          let content = text.split("\n").reduce((acc, curr) => {
            return acc + "\n" + curr.replace(/^(?:[ ]{4}|[\t])/, "");
          }, "");

          const contentLastLine = content.trimEnd().split("\n").pop();
          content +=
            // add lines after list, blockquote, codefence, and table
            contentLastLine &&
            /^[ \t]*?[>\-*][ ]|[`]{3,}$|^[ \t]*?[|].+[|]$/.test(contentLastLine)
              ? "\n\n"
              : "";

          const token: Footnote = {
            type: "footnote",
            raw,
            label,
            refs: [],
            content: this.lexer.blockTokens(content),
          };
          footnotes.rawItems.push(token);
          return token;
        },
        renderer(): string {
          // Definitions render via the footnotes section, not in place.
          return "";
        },
      },
      {
        name: "footnoteRef",
        level: "inline",
        tokenizer(src: string): FootnoteRef | undefined {
          const match = /^\[\^([^\]\n]+)\]/.exec(src);
          if (!match) return;

          const footnotesToken = this.lexer.tokens[0] as Footnotes | undefined;
          if (!footnotesToken || footnotesToken.type !== "footnotes") return;

          const raw = match[0];
          const label = match[1]!;
          const rawFootnote = footnotesToken.rawItems.find((item) => item.label === label);
          // No matching definition — leave the text literal.
          if (!rawFootnote) return;

          const footnote = footnotesToken.items.find((item) => item.label === label);
          const ref: FootnoteRef = {
            type: "footnoteRef",
            raw,
            index: rawFootnote.refs.length,
            id: "",
            label,
          };

          if (footnote) {
            ref.id = footnote.refs[0]!.id;
            footnote.refs.push(ref);
          } else {
            state.order++;
            ref.id = String(state.order);
            rawFootnote.refs.push(ref);
            footnotesToken.items.push(rawFootnote);
          }
          return ref;
        },
        renderer(token: Tokens.Generic): string {
          const { index, id, label } = token as unknown as FootnoteRef;
          const encodedLabel = encodeURIComponent(label);
          const idSuffix = index > 0 ? `-${index + 1}` : "";
          return `<sup><a id="${state.prefix}ref-${encodedLabel}${idSuffix}" href="#${state.prefix}${encodedLabel}" data-footnote-ref>${id}</a></sup>`;
        },
      },
      {
        name: "footnotes",
        renderer(token: Tokens.Generic): string {
          const { items = [] } = token as unknown as Footnotes;
          if (items.length === 0) return "";

          const itemsHtml = items.reduce((acc, { label, content, refs }) => {
            const encodedLabel = encodeURIComponent(label);
            const parsedContent = this.parser.parse(content).trimEnd();
            const endsWithP = parsedContent.endsWith("</p>");

            let item = `<li id="${state.prefix}${encodedLabel}">\n`;
            item += endsWithP ? parsedContent.replace(/<\/p>$/, "") : parsedContent;

            refs.forEach((_, i) => {
              const displayIndex = i + 1;
              const textLabel = i > 0 ? `↩<sup>${displayIndex}</sup>` : "↩";
              const idSuffix = i > 0 ? `-${displayIndex}` : "";
              item += ` <a href="#${state.prefix}ref-${encodedLabel}${idSuffix}" data-footnote-backref aria-label="Back to reference ${label}">${textLabel}</a>`;
            });

            item += endsWithP ? "</p>\n" : "\n";
            item += "</li>\n";
            return acc + item;
          }, "");

          return `<section class="footnotes" aria-label="Footnotes">\n<ol>\n${itemsHtml}</ol>\n</section>\n`;
        },
      },
    ],
    walkTokens(token: Token) {
      if (
        token.type === "footnotes" &&
        lexer.tokens.indexOf(token) === 0 &&
        (token as unknown as Footnotes).items.length
      ) {
        lexer.tokens[0] = { type: "space", raw: "" } as Token;
        lexer.tokens.push(token);
      }
      if (lexer.hasFootnotes) lexer.hasFootnotes = false;
    },
  };
}
