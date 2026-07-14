import { SpinnerSvg } from "./SpinnerSvg";

interface IndexBuildingPlaceholderProps {
  variant: "inline" | "centered";
}

export function IndexBuildingPlaceholder({ variant }: IndexBuildingPlaceholderProps) {
  if (variant === "inline") {
    return (
      <div className="px-4 py-2">
        <div className="flex items-center gap-2 py-1">
          <SpinnerSvg className="h-3 w-3 text-text-faint" />
          <span className="text-xs text-text-faint">Building index...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex items-center gap-2">
        <SpinnerSvg className="h-4 w-4 text-text-faint" />
        <span className="text-sm text-text-faint">Building index...</span>
      </div>
    </div>
  );
}
