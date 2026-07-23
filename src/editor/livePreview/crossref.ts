import {
  type Extension,
  StateEffect,
  StateField,
  Facet,
} from "@codemirror/state";
import {
  Decoration,
EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { CrossrefWidget, DefinitionWidget } from "./crossrefWidgets";
import { resolveAllDecorations, type AllDecorations } from "../../lib/ipc";

const EMPTY: AllDecorations = { citations: [], definition_tags: [] };

export const frontmatterFacet = Facet.define<
  Record<string, unknown>,
  Record<string, unknown>
>({
  combine: (values) => values[0] ?? {},
});

export const setCrossrefData = StateEffect.define<AllDecorations>();

export const crossrefField = StateField.define<AllDecorations>({
  create: () => EMPTY,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setCrossrefData)) return e.value;
    }
    return value;
  },
});

export function isInEditableRange(
  refStart: number,
  refEnd: number,
  cursorPos: number,
  selStart: number,
  selEnd: number,
): boolean {
  const bufferedStart = refStart - 1;
  const bufferedEnd = refEnd + 1;
  if (cursorPos >= bufferedStart && cursorPos <= bufferedEnd) return true;
  if (selStart < refEnd && selEnd > refStart) return true;
  return false;
}

const crossrefPlugin = ViewPlugin.fromClass(
  class {
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private generation = 0;
    private destroyed = false;

    constructor(private view: EditorView) {
      this.fireIPC();
    }

    update(update: ViewUpdate) {
      const fmChanged =
        update.state.facet(frontmatterFacet) !== update.startState.facet(frontmatterFacet);
      if (!update.docChanged && !fmChanged) return;
      this.scheduleIPC();
    }

    private scheduleIPC() {
      if (this.debounceTimer != null) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.fireIPC();
      }, 150);
    }

    private fireIPC() {
      const gen = ++this.generation;
      const docStr = this.view.state.doc.toString();
      const frontmatter = this.view.state.facet(frontmatterFacet);
      resolveAllDecorations(docStr, frontmatter)
        .then((data) => {
          if (this.destroyed || gen !== this.generation) return;
          if (!data) return;
          if (this.view.state.doc.toString() !== docStr) {
            // Stale: doc changed during IPC flight - retry (#912)
            this.scheduleIPC();
            return;
          }
          this.view.dispatch({ effects: setCrossrefData.of(data) });
        })
        .catch(() => {});
    }

    destroy() {
      this.destroyed = true;
      if (this.debounceTimer != null) clearTimeout(this.debounceTimer);
    }
  },
);

const decorationProvider = EditorView.decorations.compute(
  [crossrefField, "selection"],
  (state) => {
    const data = state.field(crossrefField);
    const docLen = state.doc.length;
    const sel = state.selection.main;
    const cursorPos = sel.head;
    const selStart = sel.from;
    const selEnd = sel.to;

    const decos: { from: number; to: number; deco: Decoration }[] = [];

    for (const c of data.citations) {
      if (c.char_start < 0 || c.char_end > docLen || c.char_start >= c.char_end) continue;
      if (isInEditableRange(c.char_start, c.char_end, cursorPos, selStart, selEnd)) continue;
      decos.push({
        from: c.char_start,
        to: c.char_end,
        deco: Decoration.replace({
          widget: new CrossrefWidget(
            c.original,
            c.rendered_text,
            c.is_valid,
            c.char_start,
            c.char_end,
            c.target_char_offset,
          ),
        }),
      });
    }

    for (const d of data.definition_tags) {
      if (d.char_start < 0 || d.char_end > docLen || d.char_start >= d.char_end) continue;
      if (!d.is_valid) continue;
      if (isInEditableRange(d.char_start, d.char_end, cursorPos, selStart, selEnd)) continue;
      decos.push({
        from: d.char_start,
        to: d.char_end,
        deco: Decoration.replace({
          widget: new DefinitionWidget(
            d.original,
            d.rendered_text,
            d.is_valid,
            d.char_start,
            d.char_end,
          ),
        }),
      });
    }

    decos.sort((a, b) => a.from - b.from || a.to - b.to);

    return Decoration.set(
      decos.map((d) => d.deco.range(d.from, d.to)),
    );
  },
);

export function crossrefExtension(): Extension {
  return [crossrefField, crossrefPlugin, decorationProvider];
}
