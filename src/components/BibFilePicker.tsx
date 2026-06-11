interface BibFilePickerProps {
  bibFiles: string[];
  selectedBibFile: string;
  onSelectedBibFileChange: (v: string) => void;
  newBibPath: string;
  onNewBibPathChange: (v: string) => void;
  testIdPrefix: string;
}

export function BibFilePicker({
  bibFiles,
  selectedBibFile,
  onSelectedBibFileChange,
  newBibPath,
  onNewBibPathChange,
  testIdPrefix,
}: BibFilePickerProps) {
  return (
    <div>
      <label className="mb-1 block text-sm text-text-muted">Target .bib file</label>
      {bibFiles.length > 0 ? (
        <select
          data-testid={`${testIdPrefix}-bib-select`}
          className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
          value={selectedBibFile}
          onChange={(e) => onSelectedBibFileChange(e.target.value)}
        >
          <option value="">Select a file...</option>
          {bibFiles.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          <option value="__new__">New file...</option>
        </select>
      ) : (
        <select
          data-testid={`${testIdPrefix}-bib-select`}
          className="hidden"
          value="__new__"
          onChange={() => {}}
        />
      )}

      {selectedBibFile === "__new__" && (
        <div className="mt-2">
          <input
            data-testid={`${testIdPrefix}-bib-new-input`}
            type="text"
            className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
            value={newBibPath}
            onChange={(e) => onNewBibPathChange(e.target.value)}
            placeholder="e.g. refs.bib"
          />
        </div>
      )}
    </div>
  );
}
