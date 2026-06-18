import type {
  CompletionContext,
  CompletionResult,
  Completion,
} from "@codemirror/autocomplete";
import { listPages, searchPagesByTitle, getPageHeadings } from "../../lib/ipc";
import { extractHeadings } from "../../lib/headings";
import { useWorkspaceStore } from "../../stores/workspace";

export interface WikilinkTriggerInfo {
  from: number;
  phase: "page" | "section";
  query: string;
  pageName?: string;
}

export function parseWikilinkTrigger(
  lineText: string,
  lineStart: number,
  posInLine: number,
): WikilinkTriggerInfo | null {
  const before = lineText.slice(0, posInLine);

  let searchFrom = before.length;
  let bracketIdx = -1;
  while (searchFrom > 0) {
    const idx = before.lastIndexOf("[[", searchFrom - 1);
    if (idx === -1) break;
    const closeIdx = before.indexOf("]]", idx + 2);
    if (closeIdx === -1) {
      bracketIdx = idx;
      break;
    }
    searchFrom = idx;
  }

  if (bracketIdx === -1) return null;

  const inside = before.slice(bracketIdx + 2);
  const hashIdx = inside.indexOf("#");

  if (hashIdx === -1) {
    return {
      from: lineStart + bracketIdx + 2,
      phase: "page",
      query: inside,
    };
  }

  const pageName = inside.slice(0, hashIdx);
  const query = inside.slice(hashIdx + 1);
  return {
    from: lineStart + bracketIdx + 2 + hashIdx + 1,
    phase: "section",
    query,
    pageName,
  };
}

export async function wikilinkCompletionSource(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  if (!useWorkspaceStore.getState().graphReady) return null;

  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const posInLine = pos - line.from;

  const trigger = parseWikilinkTrigger(line.text, line.from, posInLine);
  if (!trigger) return null;

  if (trigger.phase === "page") {
    let options: Completion[];
    if (trigger.query === "") {
      const pages = await listPages();
      pages.sort((a, b) => (b.modified_at ?? 0) - (a.modified_at ?? 0));
      options = pages.slice(0, 10).map((p) => ({
        label: p.title,
        detail: p.relative_path,
        apply: p.title + "]]",
      }));
    } else {
      try {
        const results = await searchPagesByTitle(trigger.query, 10);
        options = results.map((r) => ({
          label: r.title,
          detail: r.id,
          apply: r.title + "]]",
        }));
      } catch {
        return null;
      }
    }
    return {
      from: trigger.from,
      options,
      validFor: /^[^\]#|]*$/,
    };
  }

  // Section phase
  let options: Completion[];
  const pageName = trigger.pageName ?? "";
  if (pageName === "") {
    const headings = extractHeadings(state.doc.toString());
    options = headings.map((h) => ({
      label: h.text,
      detail: `h${h.level}`,
      apply: h.text + "]]",
    }));
  } else {
    try {
      const headings = await getPageHeadings(pageName);
      options = headings.map((h) => ({
        label: h.text,
        detail: `h${h.level}`,
        apply: h.text + "]]",
      }));
    } catch {
      return null;
    }
  }

  return {
    from: trigger.from,
    options,
    validFor: /^[^\]|]*$/,
  };
}
