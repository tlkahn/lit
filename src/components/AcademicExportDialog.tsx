import { useState, useEffect, useCallback, useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { usePreferencesStore } from "../stores/preferences";
import { exportDocument, exportCriticalEdition, setPreference } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";
import type { ExportDocumentResult } from "../lib/ipc";

export type ExportFormat = "latex" | "html" | "docx" | "reledmac";

interface AcademicExportDialogProps {
  open: boolean;
  onClose: () => void;
  initialFormat?: ExportFormat;
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  latex: "LaTeX",
  html: "HTML",
  docx: "DOCX",
  reledmac: "Critical Edition (LaTeX)",
};

const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  latex: "tex",
  html: "html",
  docx: "docx",
  reledmac: "tex",
};

const CSL_OPTIONS = [
  { value: "", label: "(Default)" },
  { value: "apa", label: "APA" },
  { value: "chicago-author-date", label: "Chicago (Author-Date)" },
  { value: "ieee", label: "IEEE" },
  { value: "vancouver", label: "Vancouver" },
  { value: "mla", label: "MLA" },
  { value: "acm-sig-proceedings", label: "ACM SIG Proceedings" },
  { value: "nature", label: "Nature" },
  { value: "harvard-cite-them-right", label: "Harvard" },
  { value: "american-medical-association", label: "AMA" },
  { value: "springer-basic-author-date", label: "Springer (Author-Date)" },
];

const ROUTE_OPTIONS = [
  { value: "right", label: "Right Page" },
  { value: "afootnote", label: "Apparatus Footnote" },
  { value: "bfootnote", label: "Footnote" },
  { value: "suppress", label: "Suppress" },
];

const DEFAULT_ROUTING: Record<string, string> = {
  n: "right",
  tr: "right",
  app: "afootnote",
  cf: "bfootnote",
  q: "suppress",
  todo: "suppress",
  llm: "suppress",
  th: "suppress",
};

const ROUTING_LABELS: Record<string, string> = {
  n: "Note (n)",
  tr: "Translation (tr)",
  app: "Apparatus (app)",
  cf: "Cross-ref (cf)",
  q: "Question (q)",
  todo: "Todo",
  llm: "LLM",
  th: "Thread (th)",
};

export function AcademicExportDialog({ open, onClose, initialFormat }: AcademicExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>(initialFormat ?? "latex");
  const [outputPath, setOutputPath] = useState("");
  const [csl, setCsl] = useState("");
  const [template, setTemplate] = useState("");
  const [referenceDoc, setReferenceDoc] = useState("");
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportDocumentResult | null>(null);
  const [lineNumbers, setLineNumbers] = useState(true);
  const [routing, setRouting] = useState<Record<string, string>>({ ...DEFAULT_ROUTING });

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  const prefs = usePreferencesStore.getState();

  useEffect(() => {
    if (open) {
      setFormat(initialFormat ?? "latex");
      setOutputPath("");
      setCsl(prefs.academicDefaultCsl || "");
      setTemplate(prefs.academicDefaultTemplate || "");
      setReferenceDoc(prefs.academicDefaultReferenceDoc || "");
      setResult(null);
      setExporting(false);

      setRouting({ ...DEFAULT_ROUTING });
      setLineNumbers(true);
    }
  }, [open, initialFormat]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  async function handleBrowse() {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const ext = FORMAT_EXTENSIONS[format];
      const dest = await save({
        defaultPath: `export.${ext}`,
        filters: [{ name: FORMAT_LABELS[format], extensions: [ext] }],
      });
      if (dest) {
        setOutputPath(dest);
      }
    } catch (e) {
      console.error("Save dialog failed:", e);
    }
  }

  async function handleExport() {
    const relativePath = useWorkspaceStore.getState().currentPagePath;
    if (!relativePath || !outputPath) return;

    setExporting(true);
    setResult(null);
    try {
      let exportResult: ExportDocumentResult;

      if (format === "reledmac") {
        setPreference("academic.reledmacRouting", routing).catch(() => {});
        setPreference("academic.reledmacLineNumbers", lineNumbers).catch(() => {});

        exportResult = await exportCriticalEdition({
          relativePath,
          outputPath,
          csl: csl || undefined,
          lineNumbers,
          routing,
        });
      } else {
        exportResult = await exportDocument({
          relativePath,
          outputPath,
          format,
          csl: csl || undefined,
          template: format === "latex" && template ? template : undefined,
          referenceDoc: format === "docx" && referenceDoc ? referenceDoc : undefined,
        });
      }
      setResult(exportResult);
    } catch (e) {
      setResult({
        output_path: outputPath,
        success: false,
        stderr: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setExporting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="academic-export-backdrop"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="rounded-lg bg-bg-primary w-[32rem] max-h-[80vh] flex flex-col"
        data-testid="academic-export-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold text-text-normal">Academic Export</h2>
          <button
            className="rounded p-1 text-text-muted hover:bg-bg-secondary"
            onClick={onClose}
            data-testid="academic-export-close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4">
          {/* Format selector */}
          <div>
            <label className="block text-sm text-text-muted mb-1">Format</label>
            <select
              data-testid="academic-export-format"
              className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as ExportFormat);
                setOutputPath("");
              }}
            >
              {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
                <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
              ))}
            </select>
          </div>

          {/* Output path */}
          <div>
            <label className="block text-sm text-text-muted mb-1">Output Path</label>
            <div className="flex gap-2">
              <input
                data-testid="academic-export-output-path"
                type="text"
                readOnly
                className="flex-1 rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
                value={outputPath}
                placeholder="Select output file..."
              />
              <button
                data-testid="academic-export-browse-btn"
                onClick={handleBrowse}
                className="rounded border border-border px-3 py-1.5 text-sm text-text-normal hover:bg-bg-secondary"
              >
                Browse...
              </button>
            </div>
          </div>

          {/* CSL override */}
          <div>
            <label className="block text-sm text-text-muted mb-1">Citation Style</label>
            <select
              data-testid="academic-export-csl"
              className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
              value={csl}
              onChange={(e) => setCsl(e.target.value)}
            >
              {CSL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Template override (latex only, not reledmac) */}
          {format === "latex" && (
            <div>
              <label className="block text-sm text-text-muted mb-1">Template Path</label>
              <input
                data-testid="academic-export-template"
                type="text"
                className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                placeholder="(Default pandoc template)"
              />
            </div>
          )}

          {/* Reference doc (docx only) */}
          {format === "docx" && (
            <div>
              <label className="block text-sm text-text-muted mb-1">Reference Document</label>
              <input
                data-testid="academic-export-reference-doc"
                type="text"
                className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
                value={referenceDoc}
                onChange={(e) => setReferenceDoc(e.target.value)}
                placeholder="(Default reference doc)"
              />
            </div>
          )}

          {/* Reledmac-specific: line numbers + routing table */}
          {format === "reledmac" && (
            <>
              <div className="flex items-center gap-2">
                <input
                  data-testid="reledmac-line-numbers"
                  type="checkbox"
                  checked={lineNumbers}
                  onChange={(e) => setLineNumbers(e.target.checked)}
                  id="line-numbers-checkbox"
                />
                <label htmlFor="line-numbers-checkbox" className="text-sm text-text-normal">
                  Line numbers (every 5 lines)
                </label>
              </div>

              <div>
                <label className="block text-sm text-text-muted mb-2">Annotation Routing</label>
                <div data-testid="reledmac-routing-table" className="space-y-1.5">
                  {Object.keys(DEFAULT_ROUTING).map((key) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="w-32 text-sm text-text-normal">{ROUTING_LABELS[key] || key}</span>
                      <select
                        data-testid={`reledmac-route-${key}`}
                        className="flex-1 rounded border border-border bg-bg-secondary px-2 py-1 text-sm text-text-normal"
                        value={routing[key] || "suppress"}
                        onChange={(e) => setRouting((prev) => ({ ...prev, [key]: e.target.value }))}
                      >
                        {ROUTE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Result display */}
          {result && result.success && (
            <div data-testid="academic-export-success" className="rounded border border-border bg-bg-secondary p-3 text-sm text-text-success">
              Export complete: {result.output_path}
            </div>
          )}

          {result && !result.success && (
            <div data-testid="academic-export-error" className="rounded border border-border bg-bg-secondary p-3 text-sm text-text-error space-y-1">
              <div className="whitespace-pre-line">{result.stderr}</div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5 pt-3">
          <button
            data-testid="academic-export-cancel-btn"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
          >
            Cancel
          </button>
          <button
            data-testid="academic-export-btn"
            disabled={!outputPath || exporting}
            onClick={handleExport}
            className="rounded bg-interactive-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {exporting ? "Exporting..." : `Export to ${FORMAT_LABELS[format]}`}
          </button>
        </div>
      </div>
    </div>
  );
}
