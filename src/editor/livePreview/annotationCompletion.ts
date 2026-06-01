import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

const ANNOTATION_KEYWORDS: Record<string, string> = {
  llm: "llm",
  todo: "todo",
  q: "q",
  n: "n",
  tr: "tr",
  cf: "cf",
  app: "app",
};

export function annotationCompletionSource(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/\/\w*/);
  if (!match) return null;
  if (match.from === match.to && !ctx.explicit) return null;

  const typed = match.text.slice(1);

  const options = Object.entries(ANNOTATION_KEYWORDS)
    .filter(([key]) => key.startsWith(typed))
    .map(([key, keyword]) => ({
      label: `/${key}`,
      apply: (view: import("@codemirror/view").EditorView, _completion: unknown, from: number, to: number) => {
        const insert = `<!--- ${keyword} |  --->`;
        const cursorPos = from + insert.length - 5;
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: cursorPos },
        });
      },
    }));

  if (options.length === 0) return null;

  return {
    from: match.from,
    options,
    filter: false,
  };
}
