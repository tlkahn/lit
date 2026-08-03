import { listAllAnnotations, exportCardboxHtml } from "./ipc";
import { sortByDocPosition } from "./docOrder";
import { renderCardboxHtml } from "./cardboxHtmlExport";
import { useStatusMessageStore } from "../stores/statusMessage";
import { loadKatex } from "../editor/livePreview/katexLoader";

function filenameStem(pagePath: string): string {
  const base = pagePath.split("/").pop() ?? pagePath;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export async function exportCardboxToHtml(pagePath: string): Promise<void> {
  const statusShow = useStatusMessageStore.getState().show;

  try {
    const all = await listAllAnnotations();
    const pageCards = all.filter((a) => a.source_page_id === pagePath);
    if (pageCards.length === 0) {
      statusShow("No cards to export", "info");
      return;
    }

    const sorted = sortByDocPosition(pageCards);

    const { save } = await import("@tauri-apps/plugin-dialog");
    const stem = filenameStem(pagePath);
    const dest = await save({
      defaultPath: `${stem}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });

    if (!dest) return;

    let destination = dest;
    const lower = destination.toLowerCase();
    if (!lower.endsWith(".html") && !lower.endsWith(".htm")) {
      destination += ".html";
    }

    statusShow("Exporting cards...", "progress", 30000);

    await loadKatex();

    const title = sorted[0]?.source_page_title || stem;
    const html = renderCardboxHtml(sorted, { title });

    await exportCardboxHtml(destination, html);
    statusShow(`Exported ${sorted.length} cards`, "success");
  } catch (err) {
    statusShow(
      err instanceof Error ? err.message : String(err),
      "error",
    );
  }
}
