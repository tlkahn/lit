import type { ExportProgress, ExportSummary } from "../lib/ipc";

interface ExportDialogProps {
  visible: boolean;
  progress: ExportProgress | null;
  result: ExportSummary | null;
}

export function ExportDialog({ visible, progress, result }: ExportDialogProps) {
  if (!visible) return null;

  return (
    <div data-testid="export-dialog" className="export-dialog-overlay">
      <div className="export-dialog">
        {result ? (
          <p>Exported {result.exported_count} files to {result.destination}</p>
        ) : progress ? (
          <>
            <p>{progress.current} / {progress.total}</p>
            <progress value={progress.current} max={progress.total} />
          </>
        ) : (
          <p>Preparing export…</p>
        )}
      </div>
    </div>
  );
}
