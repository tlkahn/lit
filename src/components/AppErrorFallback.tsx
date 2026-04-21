import { useState } from "react";
import type { FallbackProps } from "./ErrorBoundary";

export function AppErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div
      className="flex h-screen flex-col items-center justify-center bg-bg-primary px-6 text-text-normal"
      data-testid="app-error-fallback"
    >
      <svg
        className="mb-4 h-14 w-14 text-text-error"
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

      <h1 className="mb-2 text-2xl font-semibold">Lit ran into a problem</h1>
      <p className="mb-8 max-w-md text-center text-sm text-text-faint">
        Your files are safe &mdash; all data is stored on disk and hasn&rsquo;t
        been affected. Try reloading the app.
      </p>

      <button
        onClick={() => {
          resetErrorBoundary();
          window.location.reload();
        }}
        className="mb-4 rounded-lg bg-interactive-accent px-6 py-3 text-text-on-accent hover:bg-interactive-accent-hover"
      >
        Reload
      </button>

      <button
        onClick={() => setShowDetails((v) => !v)}
        className="text-xs text-text-faint hover:text-text-muted"
      >
        {showDetails ? "Hide" : "Show"} details
      </button>

      {showDetails && (
        <pre className="mt-2 max-w-full overflow-auto rounded bg-bg-secondary p-3 text-xs text-text-muted">
          {error.message}
          {error.stack && `\n\n${error.stack}`}
        </pre>
      )}
    </div>
  );
}
