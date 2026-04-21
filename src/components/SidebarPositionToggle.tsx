interface SidebarPositionToggleProps {
  position: "left" | "right";
  onToggle: () => void;
}

export function SidebarPositionToggle({ position, onToggle }: SidebarPositionToggleProps) {
  return (
    <button
      onClick={onToggle}
      className="rounded px-2 py-1 text-sm text-text-muted hover:bg-bg-hover"
      aria-label={`Move sidebar to ${position === "left" ? "right" : "left"}`}
    >
      Sidebar {position === "left" ? "Right" : "Left"}
    </button>
  );
}
