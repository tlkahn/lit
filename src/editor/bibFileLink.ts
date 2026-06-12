import { Facet, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { getFileDir, resolveRelativePath } from "../lib/pathUtils";
import { useWorkspaceStore } from "../stores/workspace";

export const bibPagePathFacet: Facet<string, string> = Facet.define<
  string,
  string
>({
  combine: (values) => values[values.length - 1] ?? "",
});

export const BIB_FILE_FIELD_RE = /file\s*=\s*\{([^}]+)\}/g;

const bibFileLinkMark = Decoration.mark({ class: "cm-bib-file-link" });

function buildDecorations(view: EditorView): DecorationSet {
  const ranges: { from: number; to: number }[] = [];
  const { from, to } = view.viewport;

  for (let pos = from; pos <= to; ) {
    const line = view.state.doc.lineAt(pos);
    const re = new RegExp(BIB_FILE_FIELD_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(line.text)) !== null) {
      const pathStart = line.from + m.index + m[0].indexOf(m[1]!);
      const pathEnd = pathStart + m[1]!.length;
      ranges.push({ from: pathStart, to: pathEnd });
    }
    pos = line.to + 1;
  }

  ranges.sort((a, b) => a.from - b.from);
  return Decoration.set(
    ranges.map((r) => bibFileLinkMark.range(r.from, r.to)),
  );
}

const bibFileLinkPlugin = ViewPlugin.fromClass(
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

const modKeyTracker = ViewPlugin.fromClass(
  class {
    private onKeyDown: (e: KeyboardEvent) => void;
    private onKeyUp: (e: KeyboardEvent) => void;
    private onBlur: () => void;

    constructor(private view: EditorView) {
      this.onKeyDown = (e) => {
        if (e.key === "Meta" || e.key === "Control") {
          this.view.dom.classList.add("cm-mod-held");
        }
      };
      this.onKeyUp = (e) => {
        if (e.key === "Meta" || e.key === "Control") {
          this.view.dom.classList.remove("cm-mod-held");
        }
      };
      this.onBlur = () => {
        this.view.dom.classList.remove("cm-mod-held");
      };

      document.addEventListener("keydown", this.onKeyDown);
      document.addEventListener("keyup", this.onKeyUp);
      window.addEventListener("blur", this.onBlur);
    }

    update(_update: ViewUpdate) {}

    destroy() {
      document.removeEventListener("keydown", this.onKeyDown);
      document.removeEventListener("keyup", this.onKeyUp);
      window.removeEventListener("blur", this.onBlur);
      this.view.dom.classList.remove("cm-mod-held");
    }
  },
);

function createBibFileClickHandler(): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false;
      if (!event.ctrlKey && !event.metaKey) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const line = view.state.doc.lineAt(pos);
      const re = new RegExp(BIB_FILE_FIELD_RE.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(line.text)) !== null) {
        const pathStart = line.from + m.index + m[0].indexOf(m[1]!);
        const pathEnd = pathStart + m[1]!.length;
        if (pos < pathStart || pos > pathEnd) continue;

        event.preventDefault();
        const filePath = m[1]!;
        const pagePath = view.state.facet(bibPagePathFacet);
        const dir = getFileDir(pagePath);
        const resolved =
          dir != null ? resolveRelativePath(dir, filePath) : filePath;
        useWorkspaceStore.getState().selectPage(resolved);
        return true;
      }

      return false;
    },
  });
}

const bibFileLinkTheme = EditorView.baseTheme({
  "&.cm-mod-held .cm-bib-file-link": {
    textDecoration: "underline",
    cursor: "pointer",
    color: "var(--text-accent)",
  },
});

export function bibFileLinkExtension(
  compartment: { of: (ext: Extension) => Extension },
  initialPagePath: string,
): Extension {
  return [
    compartment.of(bibPagePathFacet.of(initialPagePath)),
    modKeyTracker,
    bibFileLinkPlugin,
    createBibFileClickHandler(),
    bibFileLinkTheme,
  ];
}
