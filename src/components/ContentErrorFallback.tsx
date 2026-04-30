import { useState } from "react";
import type { FallbackProps } from "./ErrorBoundary";

export function ContentErrorFallback({
  error,
  resetErrorBoundary,
}: FallbackProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <main
      className="flex flex-1 flex-col items-center justify-center bg-bg-primary-alt px-6"
      data-testid="content-error-fallback"
    >
      <span className="nerd-font mb-4 text-[3rem] leading-none text-text-error">{''}</span>

      <h2 className="mb-2 text-lg font-semibold text-text-normal">
        Something went wrong in the editor
      </h2>
      <p className="mb-6 max-w-md text-center text-sm text-text-faint">
        Your files are safe &mdash; all data is stored on disk and hasn&rsquo;t
        been affected.
      </p>

      <button
        onClick={resetErrorBoundary}
        className="mb-4 rounded-lg bg-interactive-accent px-6 py-2 text-text-on-accent hover:bg-interactive-accent-hover"
      >
        Try Again
      </button>

      <p className="mb-4 text-xs text-text-faint">
        You can also select a different page from the sidebar.
      </p>

      <button
        onClick={() => setShowDetails((v) => !v)}
        className="text-xs text-text-faint hover:text-text-muted"
      >
        {showDetails ? "Hide" : "Show"} details
      </button>

      {showDetails && (
        <pre className="mt-2 max-w-full overflow-auto rounded bg-bg-secondary p-3 text-xs text-text-muted">
          {error.message}
        </pre>
      )}
    </main>
  );
}
