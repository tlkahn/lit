interface SidebarPositionToggleProps {
  position: "left" | "right";
  onToggle: () => void;
}

export function SidebarPositionToggle({ position, onToggle }: SidebarPositionToggleProps) {
  return (
    <button
      onClick={onToggle}
      className="rounded px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700"
      aria-label={`Move sidebar to ${position === "left" ? "right" : "left"}`}
    >
      Sidebar {position === "left" ? "Right" : "Left"}
    </button>
  );
}
