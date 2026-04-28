import type { Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { crossrefField, isInEditableRange } from "./crossref";
import {
  citeprocMatchesField,
  bibEntriesField,
  buildCiteprocLinks,
} from "./citeproc";
import { recordDeparture, highlightLine } from "./crossrefWidgets";
import { recordCiteprocDeparture } from "./citeprocWidget";
import { isJumpNavigation } from "../jumpHistory";
import { globalJumpTracker } from "../jumpTracker";
import { useWorkspaceStore } from "../../stores/workspace";

export function resolveCiteprocKeyIndex(
  rawText: string,
  matchFrom: number,
  clickPos: number,
): number {
  const relativePos = clickPos - matchFrom;
  if (relativePos <= 0) return 0;
  if (relativePos >= rawText.length - 1) {
    const segments = rawText.slice(1, -1).split(";");
    return Math.max(0, segments.length - 1);
  }

  const inner = rawText.slice(1, -1);
  const segments = inner.split(";");
  if (segments.length <= 1) return 0;

  let offset = 1;
  for (let i = 0; i < segments.length; i++) {
    const segEnd = offset + segments[i]!.length;
    if (relativePos < segEnd) return i;
    if (relativePos === segEnd && i < segments.length - 1) return i;
    offset = segEnd + 1;
  }
  return segments.length - 1;
}

function createCitationClickHandler(): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false;
      if (!event.ctrlKey && !event.metaKey) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const sel = view.state.selection.main;
      const cursorPos = sel.head;
      const selStart = sel.from;
      const selEnd = sel.to;

      const crossrefData = view.state.field(crossrefField);
      for (const c of crossrefData.citations) {
        if (pos < c.char_start || pos > c.char_end) continue;
        if (!isInEditableRange(c.char_start, c.char_end, cursorPos, selStart, selEnd)) continue;

        event.preventDefault();
        if (c.is_valid && c.target_char_offset != null) {
          recordDeparture(view, c.char_start);
          view.dispatch({
            selection: { anchor: c.target_char_offset },
            scrollIntoView: true,
            annotations: isJumpNavigation.of(true),
          });
          highlightLine(view, c.target_char_offset);
        } else {
          view.dispatch({ selection: { anchor: c.char_start } });
        }
        view.focus();
        return true;
      }

      const matches = view.state.field(citeprocMatchesField);
      const bibData = view.state.field(bibEntriesField);

      for (const match of matches) {
        if (pos < match.from || pos > match.to) continue;
        if (!isInEditableRange(match.from, match.to, cursorPos, selStart, selEnd)) continue;

        event.preventDefault();
        const rawText = view.state.doc.sliceString(match.from, match.to);
        const keyIndex = resolveCiteprocKeyIndex(rawText, match.from, pos);
        const links = buildCiteprocLinks(match.keys, bibData);
        const link = links[keyIndex];

        if (link && link.isValid && link.bibFile != null && link.lineNumber != null) {
          const { workspacePath, selectPageAtLine, currentPagePath } =
            useWorkspaceStore.getState();
          if (workspacePath && link.bibFile.startsWith(workspacePath + "/")) {
            const relativePath = link.bibFile.slice(workspacePath.length + 1);
            recordCiteprocDeparture(view, currentPagePath, match.from);
            globalJumpTracker.isNavigating = true;
            selectPageAtLine(relativePath, link.lineNumber);
            return true;
          }
        }
        view.dispatch({ selection: { anchor: match.from } });
        view.focus();
        return true;
      }

      return false;
    },
  });
}

const rawCitationMark = Decoration.mark({ class: "cm-citation-raw-link" });

const rawCitationMarks = EditorView.decorations.compute(
  [crossrefField, citeprocMatchesField, bibEntriesField, "selection"],
  (state) => {
    const sel = state.selection.main;
    const cursorPos = sel.head;
    const selStart = sel.from;
    const selEnd = sel.to;
    const docLen = state.doc.length;

    const ranges: { from: number; to: number }[] = [];

    const crossrefData = state.field(crossrefField);
    for (const c of crossrefData.citations) {
      if (c.char_start < 0 || c.char_end > docLen || c.char_start >= c.char_end) continue;
      if (!isInEditableRange(c.char_start, c.char_end, cursorPos, selStart, selEnd)) continue;
      if (!c.is_valid || c.target_char_offset == null) continue;
      ranges.push({ from: c.char_start, to: c.char_end });
    }

    const bibData = state.field(bibEntriesField);
    if (bibData.entries.length > 0 || Object.keys(bibData.renderedCitations).length > 0) {
      const matches = state.field(citeprocMatchesField);
      for (const match of matches) {
        if (match.from < 0 || match.to > docLen || match.from >= match.to) continue;
        if (!isInEditableRange(match.from, match.to, cursorPos, selStart, selEnd)) continue;
        const links = buildCiteprocLinks(match.keys, bibData);
        if (links.some((l) => l.isValid && l.bibFile != null && l.lineNumber != null)) {
          ranges.push({ from: match.from, to: match.to });
        }
      }
    }

    ranges.sort((a, b) => a.from - b.from);
    return Decoration.set(ranges.map((r) => rawCitationMark.range(r.from, r.to)));
  },
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

export function citationClickExtension(): Extension {
  return [createCitationClickHandler(), modKeyTracker, rawCitationMarks];
}
