import { describe, it, expect, vi, afterEach } from "vitest";
import { requestEditorContext } from "./editorContext";
import { DEFAULT_EDITOR_CONTEXT, type EditorContext } from "../types";

describe("requestEditorContext", () => {
  const listeners: Array<(e: Event) => void> = [];

  afterEach(() => {
    for (const fn of listeners) {
      window.removeEventListener("lit:llm-request-context", fn);
    }
    listeners.length = 0;
  });

  it("returns DEFAULT_EDITOR_CONTEXT when no listener responds", () => {
    const ctx = requestEditorContext();
    expect(ctx).toEqual(DEFAULT_EDITOR_CONTEXT);
  });

  it("returns context from a listener that invokes the callback", () => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      detail.callback({
        selectionText: "hello world",
        selectionFrom: 0,
        selectionTo: 11,
        filePath: "test.md",
      } satisfies EditorContext);
    };
    window.addEventListener("lit:llm-request-context", handler);
    listeners.push(handler);

    const ctx = requestEditorContext();
    expect(ctx.selectionText).toBe("hello world");
    expect(ctx.filePath).toBe("test.md");
    expect(ctx.selectionFrom).toBe(0);
    expect(ctx.selectionTo).toBe(11);
  });

  it("dispatches lit:llm-request-context on window", () => {
    const spy = vi.fn();
    window.addEventListener("lit:llm-request-context", spy);
    listeners.push(spy);

    requestEditorContext();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBeInstanceOf(CustomEvent);
  });
});
