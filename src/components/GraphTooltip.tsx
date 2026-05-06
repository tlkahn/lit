export interface GraphTooltipProps {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  inbound: number;
  outbound: number;
}

export function GraphTooltip({ visible, x, y, title, inbound, outbound }: GraphTooltipProps) {
  if (!visible) return null;

  return (
    <div
      className="graph-tooltip"
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        zIndex: 20,
        pointerEvents: "none",
        background: "var(--background-primary, #fff)",
        border: "1px solid var(--background-modifier-border, #ddd)",
        borderRadius: "4px",
        padding: "6px 10px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        fontSize: "12px",
        maxWidth: "200px",
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "2px" }}>{title}</div>
      <div style={{ color: "var(--text-faint, #999)" }}>
        {inbound} in · {outbound} out
      </div>
    </div>
  );
}
