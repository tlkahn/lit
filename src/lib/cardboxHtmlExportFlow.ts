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

  const all = await listAllAnnotations();
  const pageCards = all.filter((a) => a.source_page_id === pagePath);
  if (pageCards.length === 0) {
    statusShow("No cards to export");
    return;
  }

  const sorted = sortByDocPosition(pageCards);

  await loadKatex();

  const { save } = await import("@tauri-apps/plugin-dialog");
  const stem = filenameStem(pagePath);
  const dest = await save({
    defaultPath: `${stem}.html`,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });

  if (!dest) return;

  let destination = dest;
  if (!destination.toLowerCase().endsWith(".html")) {
    destination += ".html";
  }

  const title = sorted[0]?.source_page_title || stem;
  const html = renderCardboxHtml(sorted, { title });

  statusShow("Exporting cards...", "progress", 30000);

  try {
    await exportCardboxHtml(destination, html);
    statusShow(`Exported ${sorted.length} cards`, "success");
  } catch (err) {
    statusShow(
      err instanceof Error ? err.message : String(err),
      "error",
    );
  }
}
