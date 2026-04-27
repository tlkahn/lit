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
import { CiteprocWidget, type CiteprocLinkInfo } from "./citeprocWidget";
import { frontmatterFacet } from "./crossref";
import { isInEditableRange } from "./crossref";
import {
  resolveBibEntries,
  renderBibCitations,
  type BibEntry,
} from "../../lib/ipc";


export interface BibData {
  entries: BibEntry[];
  renderedCitations: Record<string, string>;
  byKey: Map<string, BibEntry>;
}

const EMPTY_BIB: BibData = { entries: [], renderedCitations: {}, byKey: new Map() };

export const noteDirFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? "",
});

export const setBibData = StateEffect.define<BibData>();

export const bibEntriesField = StateField.define<BibData>({
  create: () => EMPTY_BIB,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setBibData)) return e.value;
    }
    return value;
  },
});

export interface CiteprocKey {
  key: string;
  suppressed: boolean;
  locator?: string;
}

export interface CiteprocMatch {
  from: number;
  to: number;
  keys: CiteprocKey[];
}

const CITE_BRACKET_RE = /\[([^\]]*@[^\]]+)\]/g;
const CITE_ITEM_RE = /(-?)@([a-zA-Z0-9_][a-zA-Z0-9_:.#$%&\-+?<>~/]*)/g;

export function scanCiteprocCitations(text: string): CiteprocMatch[] {
  const results: CiteprocMatch[] = [];
  CITE_BRACKET_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = CITE_BRACKET_RE.exec(text)) !== null) {
    const inner = m[1]!;
    const keys: CiteprocKey[] = [];
    let hasCrossref = false;

    const parts = inner.split(";");
    for (const part of parts) {
      CITE_ITEM_RE.lastIndex = 0;
      const km = CITE_ITEM_RE.exec(part);
      if (!km) continue;

      const key = km[2]!;
      if (key.includes(":")) {
        hasCrossref = true;
        break;
      }

      const suppressed = km[1] === "-";
      const afterKey = part.substring(km.index + km[0].length);
      const locatorMatch = afterKey.match(/^,\s*(.+)/);
      const locator = locatorMatch ? locatorMatch[1]!.trim() : undefined;

      keys.push({ key, suppressed, locator });
    }

    if (hasCrossref || keys.length === 0) continue;

    results.push({
      from: m.index,
      to: m.index + m[0].length,
      keys,
    });
  }

  return results;
}

export const citeprocMatchesField = StateField.define<CiteprocMatch[]>({
  create(state) {
    return scanCiteprocCitations(state.doc.toString());
  },
  update(value, tr) {
    if (!tr.docChanged) return value;
    return scanCiteprocCitations(tr.state.doc.toString());
  },
});

function extractBibPaths(frontmatter: Record<string, unknown>): string[] {
  const bib = frontmatter["bibliography"];
  if (!bib) return [];
  if (typeof bib === "string") return [bib];
  if (Array.isArray(bib)) return bib.filter((b): b is string => typeof b === "string");
  return [];
}

const citeprocPlugin = ViewPlugin.fromClass(
  class {
    private lastBibPaths = "";
    private lastNoteDir = "";

    constructor(private view: EditorView) {
      this.checkBibChange();
    }

    update(update: ViewUpdate) {
      const fm = update.state.facet(frontmatterFacet);
      const bibPaths = extractBibPaths(fm).join("\0");
      const noteDir = update.state.facet(noteDirFacet);

      if (bibPaths !== this.lastBibPaths) {
        this.lastBibPaths = bibPaths;
        this.lastNoteDir = noteDir;
        this.fetchBib();
      } else if (noteDir !== this.lastNoteDir && bibPaths) {
        this.lastNoteDir = noteDir;
        this.fetchBib();
      }
    }

    private checkBibChange() {
      const fm = this.view.state.facet(frontmatterFacet);
      const bibPaths = extractBibPaths(fm).join("\0");
      this.lastBibPaths = bibPaths;
      this.lastNoteDir = this.view.state.facet(noteDirFacet);
      if (bibPaths) {
        this.fetchBib();
      }
    }

    private fetchBib() {
      const paths = this.lastBibPaths.split("\0").filter(Boolean);
      if (paths.length === 0) {
        const snapshot = this.lastBibPaths;
        Promise.resolve().then(() => {
          if (this.lastBibPaths !== snapshot) return;
          this.view.dispatch({ effects: setBibData.of(EMPTY_BIB) });
        });
        return;
      }
      const noteDir = this.view.state.facet(noteDirFacet);
      const snapshotPaths = this.lastBibPaths;
      const snapshotDir = noteDir;

      resolveBibEntries(paths, noteDir)
        .then((entries) => {
          if (this.lastBibPaths !== snapshotPaths) return;
          if (this.lastNoteDir !== snapshotDir) return;
          return renderBibCitations(entries).then((rendered) => {
            if (this.lastBibPaths !== snapshotPaths) return;
            if (this.lastNoteDir !== snapshotDir) return;
            const byKey = new Map(entries.map((e) => [e.key, e]));
            this.view.dispatch({
              effects: setBibData.of({ entries, renderedCitations: rendered, byKey }),
            });
          });
        })
        .catch(() => {});
    }
  },
);

export function buildCiteprocLinks(
  keys: CiteprocKey[],
  bibData: BibData,
): CiteprocLinkInfo[] {
  return keys.map((k) => {
    const entry = bibData.byKey.get(k.key);
    if (!entry) {
      const rendered = bibData.renderedCitations[k.key];
      return { renderedText: rendered ?? `@${k.key}`, isValid: false };
    }
    const rendered = bibData.renderedCitations[k.key];
    let renderedText: string;
    if (rendered) {
      if (k.suppressed) {
        const yearMatch = rendered.match(/\d{4}/);
        renderedText = yearMatch ? yearMatch[0] : rendered;
      } else {
        renderedText = rendered;
      }
    } else {
      renderedText = `@${k.key}`;
    }
    return {
      renderedText,
      bibFile: entry.bib_file,
      lineNumber: entry.line_number + 1,
      isValid: true,
    };
  });
}

const citeprocDecorationProvider = EditorView.decorations.compute(
  [bibEntriesField, citeprocMatchesField, "selection"],
  (state) => {
    const bibData = state.field(bibEntriesField);
    const docLen = state.doc.length;
    const sel = state.selection.main;
    const cursorPos = sel.head;
    const selStart = sel.from;
    const selEnd = sel.to;

    if (bibData.entries.length === 0 && Object.keys(bibData.renderedCitations).length === 0) {
      return Decoration.none;
    }

    const matches = state.field(citeprocMatchesField);
    const decos: { from: number; to: number; deco: Decoration }[] = [];

    for (const match of matches) {
      if (match.from < 0 || match.to > docLen || match.from >= match.to) continue;
      if (isInEditableRange(match.from, match.to, cursorPos, selStart, selEnd)) continue;

      const links = buildCiteprocLinks(match.keys, bibData);
      const original = state.doc.sliceString(match.from, match.to);

      decos.push({
        from: match.from,
        to: match.to,
        deco: Decoration.replace({
          widget: new CiteprocWidget(original, links, match.from, match.to),
        }),
      });
    }

    decos.sort((a, b) => a.from - b.from || a.to - b.to);

    return Decoration.set(
      decos.map((d) => d.deco.range(d.from, d.to)),
    );
  },
);

export function citeprocExtension(): Extension {
  return [bibEntriesField, citeprocMatchesField, citeprocPlugin, citeprocDecorationProvider];
}
