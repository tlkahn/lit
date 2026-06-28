import { useEffect, useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import data from "../data/acknowledgements.json";

interface AcknowledgementsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface RustDep {
  name: string;
  version: string;
  license: string;
  repository: string;
}

interface JsDep {
  name: string;
  version: string;
  license: string;
  repository: string;
}

interface FontDep {
  name: string;
  license: string;
  url: string;
}

function DepRow({ name, version, license, url }: { name: string; version?: string; license: string; url?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <div className="min-w-0">
        {url ? (
          <button
            className="truncate text-sm text-text-normal hover:underline cursor-pointer bg-transparent border-none p-0 text-left"
            onClick={() => openUrl(url)}
            title={url}
          >
            {name}
          </button>
        ) : (
          <span className="truncate text-sm text-text-normal">{name}</span>
        )}
        {version && <span className="ml-1 text-xs text-text-muted">{version}</span>}
      </div>
      <span className="shrink-0 rounded bg-bg-secondary px-1.5 py-0.5 text-xs text-text-muted">{license}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
      {children}
    </div>
  );
}

export function AcknowledgementsDialog({ open, onClose }: AcknowledgementsDialogProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  const rust = data.rust as RustDep[];
  const js = data.js as JsDep[];
  const fonts = data.fonts as FontDep[];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="acknowledgements-backdrop"
    >
      <div className="w-[32rem] max-h-[70vh] flex flex-col rounded-lg bg-bg-primary p-5 shadow-lg" data-testid="acknowledgements-dialog">
        <h2 className="mb-3 text-base font-semibold text-text-normal">Acknowledgements</h2>
        <div className="flex-1 overflow-y-auto pr-1">
          <Section title={`Rust Libraries (${rust.length})`}>
            {rust.map((dep) => (
              <DepRow key={`rust-${dep.name}`} name={dep.name} version={dep.version} license={dep.license} url={dep.repository || undefined} />
            ))}
          </Section>
          <Section title={`JavaScript Libraries (${js.length})`}>
            {js.map((dep) => (
              <DepRow key={`js-${dep.name}`} name={dep.name} version={dep.version} license={dep.license} url={dep.repository || undefined} />
            ))}
          </Section>
          <Section title="Fonts">
            {fonts.map((font) => (
              <DepRow key={`font-${font.name}`} name={font.name} license={font.license} url={font.url} />
            ))}
          </Section>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
            onClick={onClose}
            data-testid="acknowledgements-close"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
