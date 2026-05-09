import { useLicenseStore } from "../stores/license";
import { openUrl } from "@tauri-apps/plugin-opener";

interface TrialBannerProps {
  onEnterKey: () => void;
}

export function TrialBanner({ onEnterKey }: TrialBannerProps) {
  const state = useLicenseStore((s) => s.state);
  const daysRemaining = useLicenseStore((s) => s.daysRemaining);

  if (state !== "expiring_soon") return null;

  const dayWord = daysRemaining === 1 ? "day" : "days";

  return (
    <div
      className="flex items-center justify-center gap-3 bg-amber-500/90 px-3 py-1.5 text-xs text-black"
      data-testid="trial-banner"
    >
      <span>{daysRemaining} {dayWord} left in trial</span>
      <button
        className="rounded bg-black/20 px-2 py-0.5 hover:bg-black/30"
        onClick={() => openUrl("https://lit.solar/buy")}
        data-testid="trial-banner-buy"
      >
        Buy License
      </button>
      <button
        className="rounded bg-black/20 px-2 py-0.5 hover:bg-black/30"
        onClick={onEnterKey}
        data-testid="trial-banner-enter-key"
      >
        Enter License Key
      </button>
    </div>
  );
}
