import { usePaneHistoryStore } from "../stores/paneHistory";

interface HistoryNavButtonsProps {
  paneId: string;
  testIdPrefix: string;
}

export function HistoryNavButtons({ paneId, testIdPrefix }: HistoryNavButtonsProps) {
  const canGoBack = usePaneHistoryStore((s) => s.canGoBack(paneId));
  const canGoForward = usePaneHistoryStore((s) => s.canGoForward(paneId));

  return (
    <>
      {([
        { dir: "back", can: canGoBack, onClick: () => usePaneHistoryStore.getState().goBack(paneId), label: "Go back", glyph: "‹" },
        { dir: "forward", can: canGoForward, onClick: () => usePaneHistoryStore.getState().goForward(paneId), label: "Go forward", glyph: "›" },
      ] as const).map((btn) => (
        <button
          key={btn.dir}
          disabled={!btn.can}
          onClick={btn.onClick}
          className="text-text-faint hover:text-text-normal disabled:opacity-30 disabled:cursor-not-allowed px-0.5"
          aria-label={btn.label}
          data-testid={`${testIdPrefix}${btn.dir}`}
        >
          {btn.glyph}
        </button>
      ))}
    </>
  );
}
