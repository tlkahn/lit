import { useState } from "react";
import { detectPandoc } from "../lib/ipc";
import type { PandocInfo } from "../lib/ipc";

export function AcademicExportSettings() {
  const [status, setStatus] = useState<"idle" | "detecting" | "success" | "error">("idle");
  const [info, setInfo] = useState<PandocInfo | null>(null);

  async function handleDetect() {
    setStatus("detecting");
    try {
      const result = await detectPandoc();
      setInfo(result);
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          data-testid="academic-detect-btn"
          disabled={status === "detecting"}
          onClick={handleDetect}
          className="rounded border border-border px-3 py-1 text-sm text-text-normal hover:bg-bg-secondary disabled:opacity-50"
        >
          {status === "detecting" ? "Detecting..." : "Auto-detect"}
        </button>
      </div>
      {status === "success" && info && (
        <div className="space-y-1 text-sm">
          <div data-testid="academic-pandoc-status" className="flex items-center gap-1.5">
            <span className="text-text-success">&#x2713;</span>
            <span>Pandoc: v{info.pandoc_version}</span>
          </div>
          <div data-testid="academic-crossref-status" className="flex items-center gap-1.5">
            {info.crossref_version ? (
              <>
                <span className="text-text-success">&#x2713;</span>
                <span>pandoc-crossref: v{info.crossref_version}</span>
              </>
            ) : (
              <>
                <span className="text-text-error">&#x2717;</span>
                <span>pandoc-crossref: Not found</span>
              </>
            )}
          </div>
          {info.pdf_engines.length > 0 && (
            <div data-testid="academic-pdf-engines" className="text-text-muted">
              PDF engines: {info.pdf_engines.join(", ")}
            </div>
          )}
        </div>
      )}
      {status === "error" && (
        <div className="text-sm">
          <div data-testid="academic-pandoc-status" className="flex items-center gap-1.5">
            <span className="text-text-error">&#x2717;</span>
            <span>Pandoc: Not found</span>
          </div>
        </div>
      )}
    </div>
  );
}
