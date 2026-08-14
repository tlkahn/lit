import { listAllAnnotations, exportCardboxAnki } from "./ipc";
import { sortByDocPosition } from "./docOrder";
import {
  buildCardboxAnkiNotes,
  resolveAnkiDeckName,
  ankiModelCss,
} from "./cardboxAnkiExport";
import { pagePathStem } from "./pagePathStem";
import { useStatusMessageStore } from "../stores/statusMessage";
import { loadKatex } from "../editor/livePreview/katexLoader";

export async function exportCardboxToAnki(pagePath: string): Promise<void> {
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
    const stem = pagePathStem(pagePath);
    const dest = await save({
      defaultPath: `${stem}.apkg`,
      filters: [{ name: "Anki Package", extensions: ["apkg"] }],
    });

    if (!dest) return;

    let destination = dest;
    const lower = destination.toLowerCase();
    if (!lower.endsWith(".apkg")) {
      destination += ".apkg";
    }

    statusShow("Exporting cards...", "progress", 30000);

    await loadKatex();

    const { notes, hasMath } = buildCardboxAnkiNotes(sorted);
    if (notes.length === 0) {
      statusShow("No cards to export", "info");
      return;
    }
    const deckName = resolveAnkiDeckName(sorted, pagePath);
    const extraCss = ankiModelCss(hasMath);

    await exportCardboxAnki(destination, deckName, pagePath, notes, extraCss);
    statusShow(`Exported ${notes.length} cards`, "success");
  } catch (err) {
    statusShow(
      err instanceof Error ? err.message : String(err),
      "error",
    );
  }
}
