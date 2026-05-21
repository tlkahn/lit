import { useRef, useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useLlmResponseStore } from "../stores/llmResponse";
import { cancelLlmStream } from "../lib/llmClient";
import { parsePrefix, type ParsedInput } from "../lib/promptFormatter";
import { DEFAULT_EDITOR_CONTEXT, type EditorContext } from "../types";

interface LlmResponsePanelProps {
  contentHeight?: number;
  onSubmit?: (parsed: ParsedInput, context: EditorContext) => void;
}

export function wrapCallout(text: string): string {
  if (!text) return "";
  const lines = text.split("\n").map((l) => `> ${l}`);
  return `> [!llm]+ Response\n${lines.join("\n")}`;
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

function QuestionInput({ onSubmit, disabled }: {
  onSubmit?: (parsed: ParsedInput, context: EditorContext) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = () => {
    if (!value.trim() || !onSubmit) return;
    setError("");
    const parsed = parsePrefix(value);
    const context = requestEditorContext();
    if (parsed.prefix === "rewrite" && context.selectionFrom === context.selectionTo) {
      setError("Select text in the editor before using /rewrite");
      return;
    }
    onSubmit(parsed, context);
    setValue("");
  };

  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="flex gap-1">
        <textarea
          data-testid="llm-question-input"
          className="flex-1 resize-none rounded border border-divider bg-bg-primary px-2 py-1 text-sm"
          rows={2}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(""); }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={disabled}
          placeholder="Ask a question... (/insert, /rewrite)"
        />
        <button
          data-testid="llm-submit-btn"
          className="rounded bg-bg-accent px-3 py-1 text-xs text-text-on-accent hover:bg-bg-accent-hover"
          onClick={handleSubmit}
          disabled={disabled}
        >
          Ask
        </button>
      </div>
      {error && (
        <span data-testid="llm-rewrite-error" className="text-xs text-text-error">{error}</span>
      )}
    </div>
  );
}

export function LlmResponsePanel({ contentHeight, onSubmit }: LlmResponsePanelProps) {
  const status = useLlmResponseStore((s) => s.status);
  const prefix = useLlmResponseStore((s) => s.prefix);
  const question = useLlmResponseStore((s) => s.question);
  const responseText = useLlmResponseStore((s) => s.responseText);
  const errorMessage = useLlmResponseStore((s) => s.errorMessage);
  const fireSourceAnnotation = useLlmResponseStore((s) => s.fireSourceAnnotation);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "streaming" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [responseText, status]);

  if (status === "idle") {
    return (
      <div data-testid="llm-response-panel" className="flex flex-col" style={{ height: contentHeight }}>
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
            <button
              data-testid="llm-insert-btn"
              className="rounded px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover"
              onClick={() => {
                if (!responseText) return;
                if (prefix === "insert") {
                  window.dispatchEvent(
                    new CustomEvent("lit:llm-insert-raw", { detail: { text: responseText } }),
                  );
                } else {
                  const wrapped = wrapCallout(responseText);
                  window.dispatchEvent(
                    new CustomEvent("lit:llm-insert-response", { detail: { text: wrapped } }),
                  );
                }
              }}
            >
              Insert at cursor
            </button>
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
        <QuestionInput onSubmit={onSubmit} />
      )}
    </div>
  );
}
