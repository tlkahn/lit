import { Facet, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getFileDir, isAbsolutePath, isOpenablePath, resolveRelativePath } from "../lib/pathUtils";
import { doiHref, isHttpUrl } from "../lib/urlUtils";
import { INDEXED_EXTENSIONS } from "../hooks/useLeafFileType";
import { useStatusMessageStore } from "../stores/statusMessage";
import { useWorkspaceStore } from "../stores/workspace";
import { modKeyTracker, modHeldLinkStyle } from "./modKeyTracker";

export const bibPagePathFacet: Facet<string, string> = Facet.define<
  string,
  string
>({
  combine: (values) => values[values.length - 1] ?? "",
});

/**
 * Combined regex matching BibTeX file, url, and doi field values.
 * Capture groups:
 *   1 — field name (file, url, or doi)
 *   2 — brace-delimited value
 *   3 — quote-delimited value
 *
 * Uses the `i` flag since BibTeX field names are case-insensitive.
 *
 * Known limitations vs the Rust parser (src-tauri/src/bib/parser.rs):
 * - Nested braces (e.g. `file = {dir/a{b}.pdf}`) truncate at the first `}`.
 * - Multi-line values are not matched (CM6 viewport scanning is line-by-line).
 */
export const BIB_FIELD_RE =
  /(?:^|[\s,{])(file|url|doi)\s*=\s*(?:\{([^}]+)\}|"([^"]+)")/gi;

const bibFileLinkMark = Decoration.mark({ class: "cm-bib-file-link", kind: "file" });
const bibUrlMark = Decoration.mark({ class: "cm-bib-url-link", kind: "url" });
const bibDoiMark = Decoration.mark({ class: "cm-bib-url-link", kind: "doi" });


function buildDecorations(view: EditorView): DecorationSet {
  const ranges: { from: number; to: number; mark: Decoration }[] = [];
  const { from, to } = view.viewport;

  for (let pos = from; pos <= to; ) {
    const line = view.state.doc.lineAt(pos);

    BIB_FIELD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BIB_FIELD_RE.exec(line.text)) !== null) {
      const value = m[2] ?? m[3]!;
      const valueStart = line.from + m.index + m[0].lastIndexOf(value);
      const valueEnd = valueStart + value.length;
      const field = m[1]!.toLowerCase();
      const mark =
        field === "file" ? bibFileLinkMark :
        field === "doi" ? bibDoiMark :
        bibUrlMark;
      ranges.push({ from: valueStart, to: valueEnd, mark });
    }

    pos = line.to + 1;
  }

  return Decoration.set(
    ranges.map((r) => r.mark.range(r.from, r.to)),
  );
}

export const bibFileLinkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Extract lowercase extension from a path, or empty string if none. */
function getExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (dot < 0 || dot < slash) return "";
  return path.slice(dot + 1).toLowerCase();
}

function createBibFileClickHandler(): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false;
      if (!event.ctrlKey && !event.metaKey) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const pluginInstance = view.plugin(bibFileLinkPlugin);
      if (!pluginInstance) return false;

      let hitFrom: number | undefined;
      let hitTo: number | undefined;
      let hitDeco: Decoration | undefined;
      pluginInstance.decorations.between(pos, pos, (from, to, value) => {
        if (pos >= to) return; // enforce half-open [from, to) — pos at `to` is outside
        hitFrom = from;
        hitTo = to;
        hitDeco = value;
        return false; // stop after first hit
      });
      if (hitFrom === undefined || hitTo === undefined || hitDeco === undefined) return false;

      event.preventDefault();
      const rawValue = view.state.doc.sliceString(hitFrom, hitTo);

      const kind: "file" | "url" | "doi" = hitDeco.spec.kind;
      if (kind === "url" || kind === "doi") {
        const resolved = kind === "doi" ? doiHref(rawValue) : rawValue.trim();
        if (!isHttpUrl(resolved)) {
          useStatusMessageStore
            .getState()
            .show(`Invalid URL: ${rawValue}`, "error");
          return true;
        }
        openUrl(resolved).catch(() =>
          useStatusMessageStore
            .getState()
            .show("Failed to open URL", "error"),
        );
        return true;
      }

      const filePath = rawValue;
      const pagePath = view.state.facet(bibPagePathFacet);
      const dir = getFileDir(pagePath);
      const resolved =
        dir != null && !isAbsolutePath(filePath)
          ? resolveRelativePath(dir, filePath)
          : filePath;
      if (isAbsolutePath(filePath)) {
        if (!isOpenablePath(filePath)) {
          useStatusMessageStore
            .getState()
            .show(`Cannot open path: ${filePath}`, "error");
          return true;
        }
      } else {
        const ext = getExtension(filePath);
        if (!ext || !INDEXED_EXTENSIONS.has(ext)) {
          useStatusMessageStore
            .getState()
            .show(`Cannot open file type: ${ext ? `.${ext}` : "(no extension)"}`, "error");
          return true;
        }
        const pages = useWorkspaceStore.getState().pages;
        const pageExists = pages.some((p) => p.relative_path === resolved);
        if (!pageExists) {
          useStatusMessageStore
            .getState()
            .show(`File not found: ${filePath}`, "error");
          return true;
        }
      }
      useWorkspaceStore.getState().selectPage(resolved);
      return true;
    },
  });
}

export function bibFileLinkExtension(pagePath: string): Extension {
  return [
    bibPagePathFacet.of(pagePath),
    modKeyTracker,
    bibFileLinkPlugin,
    createBibFileClickHandler(),
    modHeldLinkStyle("cm-bib-file-link"),
    modHeldLinkStyle("cm-bib-url-link"),
  ];
}
