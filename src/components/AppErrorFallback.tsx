import { useState } from "react";
import type { FallbackProps } from "./ErrorBoundary";

function useIsDark() {
  if (typeof document !== "undefined") {
    return document.documentElement.classList.contains("dark");
  }
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return false;
}

export function AppErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const isDark = useIsDark();
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div
      className={`flex h-screen flex-col items-center justify-center px-6 ${isDark ? "bg-neutral-900 text-neutral-100" : "bg-white text-neutral-800"}`}
      data-testid="app-error-fallback"
    >
      <svg
        className="mb-4 h-14 w-14 text-red-500"
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
      <p
        className={`mb-8 max-w-md text-center text-sm ${isDark ? "text-neutral-400" : "text-neutral-500"}`}
      >
        Your files are safe &mdash; all data is stored on disk and hasn&rsquo;t
        been affected. Try reloading the app.
      </p>

      <button
        onClick={() => {
          resetErrorBoundary();
          window.location.reload();
        }}
        className="mb-4 rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700"
      >
        Reload
      </button>

      <button
        onClick={() => setShowDetails((v) => !v)}
        className={`text-xs ${isDark ? "text-neutral-500 hover:text-neutral-300" : "text-neutral-400 hover:text-neutral-600"}`}
      >
        {showDetails ? "Hide" : "Show"} details
      </button>

      {showDetails && (
        <pre
          className={`mt-2 max-w-full overflow-auto rounded p-3 text-xs ${isDark ? "bg-neutral-800 text-neutral-400" : "bg-neutral-100 text-neutral-600"}`}
        >
          {error.message}
          {error.stack && `\n\n${error.stack}`}
        </pre>
      )}
    </div>
  );
}
