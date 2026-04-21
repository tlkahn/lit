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
      <svg
        className="mb-4 h-12 w-12 text-text-error"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
        />
      </svg>

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
