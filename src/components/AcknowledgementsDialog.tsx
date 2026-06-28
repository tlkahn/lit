import { useEffect, useCallback, useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { openUrl } from "@tauri-apps/plugin-opener";
import data from "../data/acknowledgements.json";

interface AcknowledgementsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface Dep {
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
        {url?.startsWith("http") ? (
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

type VirtualRow =
  | { kind: "header"; title: string }
  | { kind: "dep"; name: string; version?: string; license: string; url?: string };

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

  const rust = data.rust as Dep[];
  const js = data.js as Dep[];
  const fonts = data.fonts as FontDep[];

  const rows = useMemo<VirtualRow[]>(() => {
    const result: VirtualRow[] = [];
    result.push({ kind: "header", title: `Rust Libraries (${rust.length})` });
    for (const dep of rust) {
      result.push({ kind: "dep", name: dep.name, version: dep.version, license: dep.license, url: dep.repository || undefined });
    }
    result.push({ kind: "header", title: `JavaScript Libraries (${js.length})` });
    for (const dep of js) {
      result.push({ kind: "dep", name: dep.name, version: dep.version, license: dep.license, url: dep.repository || undefined });
    }
    result.push({ kind: "header", title: "Fonts" });
    for (const font of fonts) {
      result.push({ kind: "dep", name: font.name, license: font.license, url: font.url });
    }
    return result;
  }, [rust, js, fonts]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]!.kind === "header" ? 32 : 28),
    initialRect: { width: 500, height: 600 },
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="acknowledgements-backdrop"
    >
      <div className="w-[32rem] max-h-[70vh] flex flex-col rounded-lg bg-bg-primary p-5 shadow-lg" data-testid="acknowledgements-dialog">
        <h2 className="mb-3 text-base font-semibold text-text-normal">Acknowledgements</h2>
        <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const row = rows[vItem.index]!;
              return (
                <div
                  key={vItem.index}
                  ref={virtualizer.measureElement}
                  data-index={vItem.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  {row.kind === "header" ? (
                    <h3 className="mb-2 pt-4 first:pt-0 text-xs font-semibold uppercase tracking-wide text-text-muted">{row.title}</h3>
                  ) : (
                    <DepRow name={row.name} version={row.version} license={row.license} url={row.url} />
                  )}
                </div>
              );
            })}
          </div>
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

export default AcknowledgementsDialog;
