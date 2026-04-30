import { useState } from "react";
import type { FallbackProps } from "./ErrorBoundary";

export function AppErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div
      className="flex h-screen flex-col items-center justify-center bg-bg-primary px-6 text-text-normal"
      data-testid="app-error-fallback"
    >
      <span className="nerd-font mb-4 text-[3.5rem] leading-none text-text-error">{''}</span>

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
