import "./GraphToolbar.css";

export interface GraphToolbarProps {
  mode: "full" | "local";
  depth: number;
  localDisabled?: boolean;
  dimension?: "2d" | "3d";
  onModeChange: (mode: "full" | "local") => void;
  onDepthChange: (depth: number) => void;
  onDimensionChange?: (d: "2d" | "3d") => void;
  onResetZoom: () => void;
  onSearch?: () => void;
}

export function GraphToolbar({ mode, depth, localDisabled, dimension, onModeChange, onDepthChange, onDimensionChange, onResetZoom, onSearch }: GraphToolbarProps) {
  return (
    <div className="graph-toolbar">
      {onDimensionChange && (
        <>
          <div className="graph-toolbar-group">
            <button
              aria-pressed={dimension === "2d"}
              className={`graph-toolbar-btn ${dimension === "2d" ? "active" : ""}`}
              onClick={() => onDimensionChange("2d")}
            >
              2D
            </button>
            <button
              aria-pressed={dimension === "3d"}
              className={`graph-toolbar-btn ${dimension === "3d" ? "active" : ""}`}
              onClick={() => onDimensionChange("3d")}
            >
              3D
            </button>
          </div>
          <div className="graph-toolbar-separator" />
        </>
      )}
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
    </div>
  );
}
