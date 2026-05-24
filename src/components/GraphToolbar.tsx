import "./GraphToolbar.css";

export interface GraphToolbarProps {
  mode: "full" | "local";
  depth: number;
  localDisabled?: boolean;
  selectionCount?: number;
  onModeChange: (mode: "full" | "local") => void;
  onDepthChange: (depth: number) => void;
  onResetZoom: () => void;
  onSearch?: () => void;
}

export function GraphToolbar({ mode, depth, localDisabled, selectionCount, onModeChange, onDepthChange, onResetZoom, onSearch }: GraphToolbarProps) {
  return (
    <div className="graph-toolbar">
      <div className="graph-toolbar-group">
        <button
          aria-pressed={mode === "full"}
          className={`graph-toolbar-btn ${mode === "full" ? "active" : ""}`}
          onClick={() => onModeChange("full")}
        >
          Full
        </button>
        <button
          aria-pressed={mode === "local"}
          className={`graph-toolbar-btn ${mode === "local" ? "active" : ""}`}
          onClick={() => onModeChange("local")}
          disabled={localDisabled}
        >
          Local
        </button>
      </div>
      {mode === "local" && (
        <div className="graph-toolbar-group">
          {[1, 2, 3].map((d) => (
            <button
              key={d}
              aria-pressed={depth === d}
              className={`graph-toolbar-btn ${depth === d ? "active" : ""}`}
              onClick={() => onDepthChange(d)}
            >
              {d}
            </button>
          ))}
        </div>
      )}
      <button
        className="graph-toolbar-btn"
        onClick={onResetZoom}
        aria-label="Reset zoom"
        title="Reset zoom"
      >
        ⌖
      </button>
      {onSearch && (
        <button
          className="graph-toolbar-btn"
          onClick={onSearch}
          aria-label="Search graph"
          title="Search graph"
        >
          ⌕
        </button>
      )}
      {selectionCount != null && selectionCount > 0 && (
        <span data-testid="selection-badge" className="graph-toolbar-badge">
          {selectionCount}
        </span>
      )}
    </div>
  );
}
