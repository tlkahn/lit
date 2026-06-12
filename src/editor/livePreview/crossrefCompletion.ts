import {
  type CompletionContext,
  type CompletionResult,
  type Completion,
  startCompletion,
} from "@codemirror/autocomplete";
import { ViewPlugin, type ViewUpdate, EditorView } from "@codemirror/view";
import { getDefinitions, listBibEntries, ensureInCompanionBib, type BibEntry } from "../../lib/ipc";
import { emitFrontmatterPatch } from "../../lib/frontmatterBus";
import { useWorkspaceStore } from "../../stores/workspace";
import { frontmatterFacet } from "./crossref";
import { bibEntriesField, notePathFacet, citeprocMatchesField, refetchBib } from "./citeproc";
import { listen } from "@tauri-apps/api/event";

// --- Workspace bib cache: one IPC fetch, refreshed on lit:bib-items-changed ---

interface WorkspaceBibCache {
  workspacePath: string;
  entries: BibEntry[];
  promise: Promise<BibEntry[]> | null;
}

let bibCache: WorkspaceBibCache | null = null;
let unlistenBibChanged: (() => void) | null = null;

function invalidateBibCache(): void {
  if (bibCache) {
    bibCache.entries = [];
    bibCache.promise = null;
  }
}

function initBibCacheListener(): void {
  if (unlistenBibChanged) return;
  listen("lit:bib-items-changed", invalidateBibCache).then((unlisten) => {
    unlistenBibChanged = unlisten;
  });
}

async function getWorkspaceBibEntries(workspacePath: string): Promise<BibEntry[]> {
  initBibCacheListener();

  // Cache hit: same workspace, entries populated
  if (bibCache?.workspacePath === workspacePath && bibCache.entries.length > 0) {
    return bibCache.entries;
  }
  // In-flight request for same workspace: coalesce
  if (bibCache?.workspacePath === workspacePath && bibCache.promise) {
    return bibCache.promise;
  }

  const cache: WorkspaceBibCache = { workspacePath, entries: [], promise: null };
  bibCache = cache;

  cache.promise = listBibEntries(workspacePath)
    .then((entries) => {
      if (bibCache === cache) {
        cache.entries = entries;
        cache.promise = null;
      }
      return entries;
    })
    .catch(() => {
      if (bibCache === cache) {
        cache.promise = null;
      }
      return [] as BibEntry[];
    });

  return cache.promise;
}

/** @internal Exported for tests only */
export function _resetBibCacheForTesting(): void {
  bibCache = null;
  if (unlistenBibChanged) {
    unlistenBibChanged();
    unlistenBibChanged = null;
  }
}

export interface TriggerInfo {
  from: number;
  phase: "type" | "id";
  refType?: string;
  bibFrom?: number;
}

const REF_TYPES: { label: string; detail: string }[] = [
  { label: "fig:", detail: "Figure" },
  { label: "tbl:", detail: "Table" },
  { label: "sec:", detail: "Section" },
  { label: "eq:", detail: "Equation" },
  { label: "lst:", detail: "Listing" },
  { label: "bib:", detail: "Bibliography" },
];

export function parseTrigger(
  lineText: string,
  lineStart: number,
  posInLine: number,
): TriggerInfo | null {
  const before = lineText.slice(0, posInLine);

  const bracketIdx = before.lastIndexOf("[");
  if (bracketIdx === -1) return null;

  const afterBracket = before.slice(bracketIdx);
  if (!afterBracket.startsWith("[@")) return null;

  if (afterBracket.indexOf("]", 2) !== -1) return null;

  const lastSemi = afterBracket.lastIndexOf(";");
  let segmentStart: number;
  let segment: string;

  if (lastSemi !== -1) {
    const afterSemi = afterBracket.slice(lastSemi + 1);
    const atMatch = afterSemi.match(/^\s*@/);
    if (!atMatch) return null;
    segmentStart = bracketIdx + lastSemi + 1 + atMatch[0].length;
    segment = afterSemi.slice(atMatch[0].length);
  } else {
    segmentStart = bracketIdx + 2;
    segment = afterBracket.slice(2);
  }

  const colonIdx = segment.indexOf(":");
  if (colonIdx === -1) {
    const from = lineStart + segmentStart;
    return { from, phase: "type" };
  }

  const refType = segment.slice(0, colonIdx);
  const validTypes = ["fig", "tbl", "sec", "eq", "lst", "bib"];
  if (!validTypes.includes(refType)) return null;

  const afterColon = lineStart + segmentStart + colonIdx + 1;

  if (refType === "bib") {
    const atPos =
      lastSemi !== -1
        ? before.lastIndexOf("@", posInLine)
        : bracketIdx + 1;
    return { from: afterColon, phase: "id", refType, bibFrom: lineStart + atPos };
  }

  return { from: afterColon, phase: "id", refType };
}

export async function crossrefCompletionSource(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const posInLine = pos - line.from;

  const trigger = parseTrigger(line.text, line.from, posInLine);
  if (!trigger) return null;

  if (trigger.phase === "type") {
    const options: Completion[] = REF_TYPES.map((t) => ({
      label: t.label,
      detail: t.detail,
      apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
        view.dispatch({ changes: { from, to, insert: t.label } });
        startCompletion(view);
      },
    }));
    return {
      from: trigger.from,
      options,
      validFor: /^[a-z]*$/,
    };
  }

  if (trigger.refType === "bib") {
    const workspacePath = useWorkspaceStore.getState().workspacePath;
    const notePath = state.facet(notePathFacet);
    const bibData = state.field(bibEntriesField, false);

    const allEntries = workspacePath
      ? await getWorkspaceBibEntries(workspacePath)
      : [];

    const noteKeys = new Set(bibData?.entries.map(e => e.key) ?? []);
    const renderedCitations = bibData?.renderedCitations ?? {};

    const mergedEntries: BibEntry[] = [
      ...(bibData?.entries ?? []),
      ...allEntries.filter(e => !noteKeys.has(e.key)),
    ];

    if (mergedEntries.length === 0) return null;

    const options: Completion[] = mergedEntries.map((entry) => ({
      label: entry.key,
      detail: renderedCitations[entry.key] ?? `${entry.authors.join(", ")} (${entry.year})`,
      apply: (view: EditorView, _completion: Completion, _from: number, to: number) => {
        view.dispatch({ changes: { from: trigger.bibFrom!, to, insert: entry.key } });
        if (workspacePath && notePath) {
          ensureInCompanionBib(entry.key, notePath, workspacePath, true)
            .then((result) => {
              if (result.bibliography_value) {
                emitFrontmatterPatch(notePath, {
                  bibliography: result.bibliography_value,
                });
              }
              // Trigger citeproc to re-read the (possibly updated) .bib file
              view.dispatch({ effects: refetchBib.of(null) });
            })
            .catch((err) => {
              console.warn(`[crossrefCompletion] ensureInCompanionBib failed for key "${entry.key}":`, err);
            });
        }
      },
    }));
    return {
      from: trigger.from,
      options,
      validFor: /^[a-zA-Z0-9_-]*$/,
    };
  }

  const frontmatter = state.facet(frontmatterFacet);
  const content = state.doc.toString();
  try {
    const defs = await getDefinitions(content, frontmatter);
    const filtered = defs.filter((d) => d.ref_type === trigger.refType);
    const options: Completion[] = filtered.map((d) => ({
      label: d.id,
      detail: `${d.number}${d.caption ? ": " + d.caption : ""}`,
    }));
    return {
      from: trigger.from,
      options,
      validFor: /^[a-zA-Z0-9_-]*$/,
    };
  } catch {
    return null;
  }
}

/**
 * Reconciliation plugin: when citeproc rendering cannot resolve a citation key
 * (the key is not in the note's .bib files) but the key exists in the workspace
 * DB, call ensureInCompanionBib to materialize it into the companion .bib file.
 * This closes the manual-typing/paste gap where the completion apply handler
 * is the only code path that calls ensureInCompanionBib.
 *
 * Each key is reconciled at most once per editor session to avoid repeated IPC.
 * Debounced to 1 second after the last doc change.
 */
export const bibReconciliationPlugin = ViewPlugin.fromClass(
  class {
    private reconciledKeys = new Set<string>();
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private view: EditorView) {
      this.scheduleReconcile();
    }

    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      this.scheduleReconcile();
    }

    private scheduleReconcile() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.reconcile();
      }, 1000);
    }

    private async reconcile() {
      const workspacePath = useWorkspaceStore.getState().workspacePath;
      const notePath = this.view.state.facet(notePathFacet);
      if (!workspacePath || !notePath) return;

      const bibData = this.view.state.field(bibEntriesField, false);
      if (!bibData) return;

      const matches = this.view.state.field(citeprocMatchesField);
      const unresolvedKeys: string[] = [];
      for (const match of matches) {
        for (const k of match.keys) {
          if (bibData.byKey.has(k.key)) continue;
          if (this.reconciledKeys.has(k.key)) continue;
          unresolvedKeys.push(k.key);
        }
      }

      if (unresolvedKeys.length === 0) return;

      const wsEntries = await getWorkspaceBibEntries(workspacePath);
      const wsKeySet = new Set(wsEntries.map((e) => e.key));

      let needsRefetch = false;
      for (const key of unresolvedKeys) {
        if (!wsKeySet.has(key)) continue;
        this.reconciledKeys.add(key);
        try {
          const result = await ensureInCompanionBib(key, notePath, workspacePath, true);
          if (result.bibliography_value) {
            emitFrontmatterPatch(notePath, {
              bibliography: result.bibliography_value,
            });
          }
          needsRefetch = true;
        } catch (err) {
          console.warn(`[bibReconciliation] ensureInCompanionBib failed for key "${key}":`, err);
        }
      }
      if (needsRefetch) {
        this.view.dispatch({ effects: refetchBib.of(null) });
      }
    }

    destroy() {
      if (this.timer) clearTimeout(this.timer);
    }
  },
);
