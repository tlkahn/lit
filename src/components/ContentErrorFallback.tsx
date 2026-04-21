import { useState } from "react";
import type { FallbackProps } from "./ErrorBoundary";

export function ContentErrorFallback({
  error,
  resetErrorBoundary,
}: FallbackProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <main
      className="flex flex-1 flex-col items-center justify-center bg-white px-6 dark:bg-neutral-800"
      data-testid="content-error-fallback"
    >
      <svg
        className="mb-4 h-12 w-12 text-amber-500"
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

      <h2 className="mb-2 text-lg font-semibold text-neutral-800 dark:text-neutral-100">
        Something went wrong in the editor
      </h2>
      <p className="mb-6 max-w-md text-center text-sm text-neutral-500 dark:text-neutral-400">
        Your files are safe &mdash; all data is stored on disk and hasn&rsquo;t
        been affected.
      </p>

      <button
        onClick={resetErrorBoundary}
        className="mb-4 rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
      >
        Try Again
      </button>

      <p className="mb-4 text-xs text-neutral-400 dark:text-neutral-500">
        You can also select a different page from the sidebar.
      </p>

      <button
        onClick={() => setShowDetails((v) => !v)}
        className="text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
      >
        {showDetails ? "Hide" : "Show"} details
      </button>

      {showDetails && (
        <pre className="mt-2 max-w-full overflow-auto rounded bg-neutral-100 p-3 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
          {error.message}
        </pre>
      )}
    </main>
  );
}
