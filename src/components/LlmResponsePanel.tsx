import { useRef, useEffect } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useLlmResponseStore } from "../stores/llmResponse";

interface LlmResponsePanelProps {
  contentHeight?: number;
}

export function wrapCallout(text: string): string {
  if (!text) return "";
  const lines = text.split("\n").map((l) => `> ${l}`);
  return `> [!llm]+ Response\n${lines.join("\n")}`;
}

function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
}

export function LlmResponsePanel({ contentHeight }: LlmResponsePanelProps) {
  const status = useLlmResponseStore((s) => s.status);
  const question = useLlmResponseStore((s) => s.question);
  const responseText = useLlmResponseStore((s) => s.responseText);
  const errorMessage = useLlmResponseStore((s) => s.errorMessage);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "streaming" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [responseText, status]);

  if (status === "idle") {
    return <div data-testid="llm-response-panel" style={{ height: contentHeight }} />;
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
                const wrapped = wrapCallout(responseText);
                if (!wrapped) return;
                window.dispatchEvent(
                  new CustomEvent("lit:llm-insert-response", {
                    detail: { text: wrapped },
                  }),
                );
              }}
            >
              Insert at cursor
            </button>
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
    </div>
  );
}
