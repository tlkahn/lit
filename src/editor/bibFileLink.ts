import { Facet, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { getFileDir, isAbsolutePath, isOpenablePath, resolveRelativePath } from "../lib/pathUtils";
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
 * Matches BibTeX `file` field values in both brace and quote-delimited forms.
 * Known limitations vs the Rust parser (src-tauri/src/bib/parser.rs):
 * - Nested braces (e.g. `file = {dir/a{b}.pdf}`) truncate at the first `}`.
 * - Multi-line values are not matched (CM6 viewport scanning is line-by-line).
 */
export const BIB_FILE_FIELD_RE =
  /(?:^|[\s,{])file\s*=\s*(?:\{([^}]+)\}|"([^"]+)")/g;

const bibFileLinkMark = Decoration.mark({ class: "cm-bib-file-link" });

function buildDecorations(view: EditorView): DecorationSet {
  const ranges: { from: number; to: number }[] = [];
  const { from, to } = view.viewport;
  const re = new RegExp(BIB_FILE_FIELD_RE.source, "g");

  for (let pos = from; pos <= to; ) {
    const line = view.state.doc.lineAt(pos);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line.text)) !== null) {
      const path = m[1] ?? m[2]!;
      const pathStart = line.from + m.index + m[0].lastIndexOf(path);
      const pathEnd = pathStart + path.length;
      ranges.push({ from: pathStart, to: pathEnd });
    }
    pos = line.to + 1;
  }

  return Decoration.set(
    ranges.map((r) => bibFileLinkMark.range(r.from, r.to)),
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
      pluginInstance.decorations.between(pos, pos, (from, to) => {
        if (pos >= to) return; // enforce half-open [from, to) — pos at `to` is outside
        hitFrom = from;
        hitTo = to;
        return false; // stop after first hit
      });
      if (hitFrom === undefined || hitTo === undefined) return false;

      event.preventDefault();
      const filePath = view.state.doc.sliceString(hitFrom, hitTo);
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
        // Unix absolute — pass through, skip existence check
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
  ];
}
