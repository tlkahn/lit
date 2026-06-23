import { lazy, Suspense } from "react";
import { CardboxErrorBoundary } from "./CardboxErrorBoundary";

const LazyCardboxView = lazy(() => import("./CardboxView"));

export function CardboxPaneView() {
  return (
    <div data-testid="cardbox-view-wrapper" className="flex-1 min-h-0 overflow-hidden">
      <CardboxErrorBoundary>
        <Suspense fallback={<div className="flex items-center justify-center h-full text-text-faint">Loading…</div>}>
          <LazyCardboxView />
        </Suspense>
      </CardboxErrorBoundary>
    </div>
  );
}
