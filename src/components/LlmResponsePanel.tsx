import { useRef, useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useLlmResponseStore } from "../stores/llmResponse";
import { useEditorSelectionStore } from "../stores/editorSelection";
import { cancelLlmStream } from "../lib/llmClient";
import { DEFAULT_EDITOR_CONTEXT, type EditorContext } from "../types";

interface LlmResponsePanelProps {
  contentHeight?: number;
  onSubmit?: (question: string, context: EditorContext) => void;
}

function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
}

export function requestEditorContext(): EditorContext {
  const context = { ...DEFAULT_EDITOR_CONTEXT };
  window.dispatchEvent(
    new CustomEvent("lit:llm-request-context", {
      detail: { callback: (ctx: EditorContext) => { Object.assign(context, ctx); } },
    }),
  );
  return context;
}

function QuestionInput({ onSubmit, disabled, autoFocus }: {
  onSubmit?: (question: string, context: EditorContext) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);

  const handleSubmit = () => {
    if (!value.trim() || !onSubmit) return;
    const context = requestEditorContext();
    onSubmit(value.trim(), context);
    setValue("");
  };

  return (
    <div className="flex items-end gap-1 px-3 py-2">
        <textarea
          ref={textareaRef}
          data-testid="llm-question-input"
          className="flex-1 resize-none rounded border border-divider bg-bg-primary px-2 py-1 text-sm outline-none focus:border-accent"
          style={{ overflow: "hidden" }}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              handleSubmit();
            }
          }}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder="Ask a question..."
        />
        <button
          data-testid="llm-submit-btn"
          className="rounded border border-transparent bg-interactive-accent px-3 py-1 text-sm text-text-on-accent hover:bg-interactive-accent-hover disabled:opacity-50"
          onClick={handleSubmit}
          disabled={disabled}
        >
          Ask
        </button>
    </div>
  );
}

export function LlmResponsePanel({ contentHeight, onSubmit }: LlmResponsePanelProps) {
  const status = useLlmResponseStore((s) => s.status);
  const question = useLlmResponseStore((s) => s.question);
  const responseText = useLlmResponseStore((s) => s.responseText);
  const errorMessage = useLlmResponseStore((s) => s.errorMessage);
  const fireSourceAnnotation = useLlmResponseStore((s) => s.fireSourceAnnotation);

  const editorFrom = useEditorSelectionStore((s) => s.from);
  const editorTo = useEditorSelectionStore((s) => s.to);
  const hadSelection = editorFrom !== editorTo;

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "streaming" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [responseText, status]);

  if (status === "idle") {
    return (
      <div data-testid="llm-response-panel" className="flex flex-col justify-end" style={{ height: contentHeight }}>
        <QuestionInput onSubmit={onSubmit} />
      </div>
    );
  }

  return (
    <div
      data-testid="llm-response-panel"
      className="flex flex-col overflow-hidden"
      style={{ height: contentHeight }}
    >
      <div className="flex items-center justify-between border-b border-divider px-3 py-1.5">
        <span className="truncate text-xs text-text-muted" data-testid="llm-question">
          {question}
        </span>
        {status === "streaming" && (
          <button
            data-testid="llm-stop-btn"
            className="rounded px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover"
            onClick={() => cancelLlmStream()}
          >
            Stop
          </button>
        )}
        {status === "done" && (
          <div className="flex items-center gap-1">
            <button
              data-testid="llm-copy-btn"
              className="rounded px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover"
              onClick={() => navigator.clipboard.writeText(responseText)}
            >
              Copy
            </button>
            {hadSelection ? (
              <button
                data-testid="llm-replace-btn"
                className="rounded px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover"
                onClick={() => {
                  if (!responseText) return;
                  window.dispatchEvent(
                    new CustomEvent("lit:llm-insert-raw", { detail: { text: responseText } }),
                  );
                }}
              >
                Replace selection
              </button>
            ) : (
              <button
                data-testid="llm-insert-btn"
                className="rounded px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover"
                onClick={() => {
                  if (!responseText) return;
                  window.dispatchEvent(
                    new CustomEvent("lit:llm-insert-raw", { detail: { text: responseText } }),
                  );
                }}
              >
                Insert at cursor
              </button>
            )}
            {fireSourceAnnotation && (
              <button
                data-testid="llm-companion-btn"
                className="rounded px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover"
                onClick={() => {
                  if (!responseText) return;
                  window.dispatchEvent(
                    new CustomEvent("lit:insert-companion-annotation", {
                      detail: { sourceAnnotation: fireSourceAnnotation, responseText },
                    }),
                  );
                }}
              >
                Insert as companion
              </button>
            )}
          </div>
        )}
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 text-sm"
      >
        {status === "error" ? (
          <div data-testid="llm-error" className="text-text-error">
            {errorMessage}
          </div>
        ) : (
          <div
            data-testid="llm-response-text"
            className="prose prose-sm break-words text-text-normal"
          >
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(responseText) }} />
            {status === "streaming" && <span className="animate-pulse">▍</span>}
          </div>
        )}
      </div>
      {status === "done" && (
        <QuestionInput onSubmit={onSubmit} autoFocus />
      )}
    </div>
  );
}
