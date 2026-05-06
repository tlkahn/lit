import "./GraphTooltip.css";

export interface GraphTooltipProps {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  connections: number;
}

export function GraphTooltip({ visible, x, y, title, connections }: GraphTooltipProps) {
  if (!visible) return null;

  return (
    <div
      className="graph-tooltip"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <div className="graph-tooltip-title">{title}</div>
      <div className="graph-tooltip-meta">
        {connections} connections
      </div>
    </div>
  );
}
