import { DEFAULT_EDITOR_CONTEXT, type EditorContext } from "../types";

export function requestEditorContext(): EditorContext {
  const context = { ...DEFAULT_EDITOR_CONTEXT };
  window.dispatchEvent(
    new CustomEvent("lit:llm-request-context", {
      detail: { callback: (ctx: EditorContext) => { Object.assign(context, ctx); } },
    }),
  );
  return context;
}
