import type { ExportProgress, LkgExportSummary, LkgImportSummary } from "../lib/ipc";

const OVERLAY_CLASS = "export-dialog-overlay";
const DIALOG_CLASS = "export-dialog";

interface LkgExportDialogProps {
  visible: boolean;
  progress: ExportProgress | null;
  result: LkgExportSummary | null;
}

export function LkgExportDialog({ visible, progress, result }: LkgExportDialogProps) {
  if (!visible) return null;

  return (
    <div data-testid="lkg-export-dialog" className={OVERLAY_CLASS}>
      <div className={DIALOG_CLASS}>
        {result ? (
          <>
            <p>Exported {result.exported_count} files to {result.destination}</p>
            <p>{result.graph_hash}</p>
          </>
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

interface LkgImportDialogProps {
  visible: boolean;
  importing: boolean;
  result: LkgImportSummary | null;
}

export function LkgImportDialog({ visible, importing, result }: LkgImportDialogProps) {
  if (!visible) return null;

  return (
    <div data-testid="lkg-import-dialog" className={OVERLAY_CLASS}>
      <div className={DIALOG_CLASS}>
        {result ? (
          <p>
            Imported {result.node_count} nodes, {result.edge_count} edges,{" "}
            {result.annotation_count} annotations, {result.file_count} files
          </p>
        ) : importing ? (
          <p>Importing…</p>
        ) : (
          <p>Preparing import…</p>
        )}
      </div>
    </div>
  );
}
