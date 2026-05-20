import { useRef, useEffect } from "react";
import { useLlmResponseStore } from "../stores/llmResponse";

interface LlmResponsePanelProps {
  contentHeight?: number;
}

function wrapCallout(text: string): string {
  const lines = text.split("\n").map((l) => `> ${l}`);
  return `> [!llm]+ Response\n${lines.join("\n")}`;
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
                window.dispatchEvent(
                  new CustomEvent("lit:llm-insert-response", {
                    detail: { text: wrapCallout(responseText) },
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
          <pre
            data-testid="llm-response-text"
            className="whitespace-pre-wrap break-words font-sans text-text-normal"
          >
            {responseText}
            {status === "streaming" && <span className="animate-pulse">▍</span>}
          </pre>
        )}
      </div>
    </div>
  );
}
