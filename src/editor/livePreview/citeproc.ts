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
import { CiteprocWidget } from "./citeprocWidget";
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

    constructor(private view: EditorView) {
      this.checkBibChange();
    }

    update(update: ViewUpdate) {
      const fm = update.state.facet(frontmatterFacet);
      const bibPaths = extractBibPaths(fm).join("\0");
      if (bibPaths !== this.lastBibPaths) {
        this.lastBibPaths = bibPaths;
        this.fetchBib();
      }
    }

    private checkBibChange() {
      const fm = this.view.state.facet(frontmatterFacet);
      const bibPaths = extractBibPaths(fm).join("\0");
      this.lastBibPaths = bibPaths;
      if (bibPaths) {
        this.fetchBib();
      }
    }

    private fetchBib() {
      const paths = this.lastBibPaths.split("\0").filter(Boolean);
      if (paths.length === 0) {
        this.view.dispatch({ effects: setBibData.of(EMPTY_BIB) });
        return;
      }
      const noteDir = this.view.state.facet(noteDirFacet);
      const snapshotPaths = this.lastBibPaths;

      resolveBibEntries(paths, noteDir)
        .then((entries) => {
          if (this.lastBibPaths !== snapshotPaths) return;
          return renderBibCitations(entries).then((rendered) => {
            if (this.lastBibPaths !== snapshotPaths) return;
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

const citeprocDecorationProvider = EditorView.decorations.compute(
  [bibEntriesField, "selection"],
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

    const text = state.doc.toString();
    const matches = scanCiteprocCitations(text);
    const decos: { from: number; to: number; deco: Decoration }[] = [];

    for (const match of matches) {
      if (match.from < 0 || match.to > docLen || match.from >= match.to) continue;
      if (isInEditableRange(match.from, match.to, cursorPos, selStart, selEnd)) continue;

      const renderedParts: string[] = [];
      let allValid = true;
      let firstBibFile: string | undefined;
      let firstLineNumber: number | undefined;

      for (const k of match.keys) {
        const entry = bibData.byKey.get(k.key);
        if (!entry) {
          allValid = false;
          const rendered = bibData.renderedCitations[k.key];
          renderedParts.push(rendered ?? `@${k.key}`);
          continue;
        }

        if (firstBibFile == null) {
          firstBibFile = entry.bib_file;
          firstLineNumber = entry.line_number;
        }

        const rendered = bibData.renderedCitations[k.key];
        if (rendered) {
          if (k.suppressed) {
            const yearMatch = rendered.match(/\d{4}/);
            renderedParts.push(yearMatch ? yearMatch[0] : rendered);
          } else {
            renderedParts.push(rendered);
          }
        } else {
          renderedParts.push(`@${k.key}`);
        }
      }

      const renderedText = renderedParts.join("; ");
      const original = text.substring(match.from, match.to);

      decos.push({
        from: match.from,
        to: match.to,
        deco: Decoration.replace({
          widget: new CiteprocWidget(
            original,
            renderedText,
            allValid,
            match.from,
            match.to,
            firstBibFile,
            firstLineNumber != null ? firstLineNumber + 1 : undefined,
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

export function citeprocExtension(): Extension {
  return [bibEntriesField, citeprocPlugin, citeprocDecorationProvider];
}
