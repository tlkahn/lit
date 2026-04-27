import type { IndexProgress, IndexPhase } from "../lib/ipc";

const phaseLabels: Record<IndexPhase, string> = {
  scanning: "Scanning files...",
  parsing: "Parsing pages...",
  resolving: "Resolving links...",
  diffing: "Checking for changes...",
  building: "Building graph...",
};

export function IndexingScreen({ progress }: { progress: IndexProgress | null }) {
  const label = progress ? phaseLabels[progress.phase] : "Initializing...";
  const ratio = progress && progress.total > 0 ? progress.current / progress.total : 0;
  const indeterminate = !progress || progress.total === 0;

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-bg-primary-alt" data-testid="indexing-screen">
      <h1 className="mb-6 text-2xl font-semibold text-text-normal">Lit</h1>
      <p className="mb-4 text-text-faint" data-testid="phase-label">{label}</p>
      <div className="h-2 w-64 overflow-hidden rounded-full bg-bg-hover" data-testid="progress-bar-track">
        <div
          className={`h-full rounded-full bg-interactive-accent transition-all duration-200 ${indeterminate ? "animate-pulse" : ""}`}
          style={{ width: indeterminate ? "100%" : `${Math.round(ratio * 100)}%` }}
          data-testid="progress-bar-fill"
        />
      </div>
    </div>
  );
}
