import { type Extension } from "@codemirror/state";
import {
  type EditorView,
  type Tooltip,
  hoverTooltip,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { listen, type UnlistenFn, type Event } from "@tauri-apps/api/event";
import {
  getBibKeyStates,
  type BibKeyState,
} from "../../lib/ipc";
import { useWorkspaceStore } from "../../stores/workspace";
import { useStatusMessageStore } from "../../stores/statusMessage";
import { citeprocMatchesField, type CiteprocMatch } from "./citeproc";
import { materializeAndOpen } from "../../lib/materializeAndOpen";
import { getCurrentEditorView } from "../../lib/editorViewRef";
import { globalJumpTracker } from "../../editor/jumpTracker";

/* ── Bib key states cache ───────────────────────────────────── */

let bibKeyStatesCache: Record<string, BibKeyState> | null = null;
let bibKeyStatesFetching: Promise<Record<string, BibKeyState>> | null = null;

export function invalidateBibKeyStatesCache(): void {
  bibKeyStatesCache = null;
  bibKeyStatesFetching = null;
}

async function getCachedBibKeyStates(): Promise<Record<string, BibKeyState>> {
  if (bibKeyStatesCache) return bibKeyStatesCache;
  if (bibKeyStatesFetching) return bibKeyStatesFetching;
  bibKeyStatesFetching = getBibKeyStates().then((states) => {
    bibKeyStatesCache = states;
    bibKeyStatesFetching = null;
    return states;
  }).catch((err) => {
    bibKeyStatesFetching = null;
    throw err;
  });
  return bibKeyStatesFetching;
}

/* ── Tooltip DOM builder ────────────────────────────────────── */

export function buildTooltipDom(
  bibKey: string,
): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-citeproc-tooltip";

  // Note: no mouseenter/mouseleave handlers — CM6 hoverTooltip manages
  // the hover lifecycle natively via HoverPlugin.watchTooltipLeave.

  const loading = document.createElement("span");
  loading.textContent = "Loading…";
  loading.style.color = "var(--text-faint)";
  dom.appendChild(loading);

  getCachedBibKeyStates().then((states) => {
    dom.textContent = "";
    const state = states[bibKey];

    if (!state) {
      const muted = document.createElement("span");
      muted.textContent = "No note available";
      muted.style.color = "var(--text-faint)";
      muted.style.fontStyle = "italic";
      dom.appendChild(muted);
      return;
    }

    const isMaterialized =
      state.materialization === "materialized" && state.page_id != null;

    const btn = document.createElement("button");
    btn.className = "cm-citeproc-tooltip-action";
    btn.textContent = isMaterialized ? "Open note" : "Create note";

    btn.addEventListener("click", () => {
      if (isMaterialized) {
        useWorkspaceStore.getState().selectPage(state.page_id!);
      } else {
        btn.disabled = true;
        btn.textContent = "Creating…";
        materializeAndOpen(bibKey, {
          recordDeparture: () => {
            const view = getCurrentEditorView();
            const pagePath = useWorkspaceStore.getState().currentPagePath;
            if (view && pagePath) {
              const head = view.state.selection.main.head;
              const line = view.state.doc.lineAt(head);
              globalJumpTracker.recordJump(
                { notePath: pagePath, line: line.number, col: head - line.from },
                { notePath: "", line: 0, col: 0 },
              );
            }
          },
        })
          .then(() => {
            invalidateBibKeyStatesCache();
          })
          .catch((err) => {
            const errStr = String(err);
            if (errStr.includes("already exists")) {
              // Note was created via another path; invalidate cache and navigate
              invalidateBibKeyStatesCache();
              btn.disabled = true;
              btn.textContent = "Opening…";
              getCachedBibKeyStates()
                .then((freshStates) => {
                  const freshState = freshStates[bibKey];
                  if (freshState?.page_id) {
                    useWorkspaceStore.getState().selectPage(freshState.page_id);
                  } else {
                    useStatusMessageStore
                      .getState()
                      .show("Note exists but could not navigate to it", "error");
                    btn.disabled = false;
                    btn.textContent = "Create note";
                  }
                })
                .catch(() => {
                  // If re-fetch also fails, show a generic toast
                  useStatusMessageStore
                    .getState()
                    .show("Note exists but could not navigate to it", "error");
                  btn.disabled = false;
                  btn.textContent = "Create note";
                });
            } else {
              btn.disabled = false;
              btn.textContent = "Create note";
              useStatusMessageStore
                .getState()
                .show(errStr, "error");
            }
          });
      }
    });

    dom.appendChild(btn);
  }).catch(() => {
    dom.textContent = "";
    const errSpan = document.createElement("span");
    errSpan.textContent = "Failed to load — hover again to retry";
    errSpan.style.color = "var(--text-faint)";
    errSpan.style.fontStyle = "italic";
    dom.appendChild(errSpan);
  });

  return dom;
}

/* ── Hover tracker ViewPlugin ───────────────────────────────── */

class CiteprocHoverTrackerImpl {
  lastHoveredKey: string | null = null;
  lastHoveredElement: HTMLElement | null = null;
  private handler: (e: MouseEvent) => void;

  constructor(private view: EditorView) {
    this.handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const keySpan = target?.closest?.(".cm-crossref-citeproc-key") as
        | HTMLElement
        | null;
      if (keySpan?.dataset?.citekey) {
        this.lastHoveredKey = keySpan.dataset.citekey;
        this.lastHoveredElement = keySpan;
      } else {
        this.lastHoveredKey = null;
        this.lastHoveredElement = null;
      }
    };
    this.view.dom.addEventListener("mouseover", this.handler);
  }

  update(_update: ViewUpdate) {}

  destroy() {
    this.view.dom.removeEventListener("mouseover", this.handler);
  }
}

export const citeprocHoverTracker =
  ViewPlugin.fromClass(CiteprocHoverTrackerImpl);

/* ── hoverTooltip source ────────────────────────────────────── */

function findMatchAtPos(
  matches: CiteprocMatch[],
  pos: number,
): CiteprocMatch | null {
  for (const match of matches) {
    if (pos >= match.from && pos <= match.to) return match;
  }
  return null;
}

export function citeprocTooltipSource(
  view: EditorView,
  pos: number,
  _side: 1 | -1,
): Tooltip | null {
  const matches = view.state.field(citeprocMatchesField, false);
  if (!matches) return null;

  const match = findMatchAtPos(matches, pos);
  if (!match || match.keys.length === 0) return null;

  // Read the last-hovered citekey from the tracker plugin
  const tracker = view.plugin(citeprocHoverTracker);
  let bibKey = tracker?.lastHoveredKey ?? null;

  // Validate the key belongs to this match; fall back to first key
  if (!bibKey || !match.keys.some((k) => k.key === bibKey)) {
    bibKey = match.keys[0]!.key;
  }

  const resolvedKey = bibKey;

  // Capture the hovered DOM element for per-key tooltip anchoring.
  // Only use it if: (1) citekey matches the resolved key, (2) element is still in the DOM.
  const anchorElement = tracker?.lastHoveredElement ?? null;
  const useAnchor =
    anchorElement != null &&
    anchorElement.dataset?.citekey === resolvedKey &&
    anchorElement.isConnected;

  return {
    pos: match.from,
    end: match.to,
    above: true,
    create() {
      return {
        dom: buildTooltipDom(resolvedKey),
        getCoords: useAnchor
          ? () => {
              const rect = anchorElement!.getBoundingClientRect();
              return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
              };
            }
          : undefined,
      };
    },
  };
}

/* ── Shared invalidation listeners (refcounted) ───────────── */

let listenerRefCount = 0;
let sharedUnlisteners: UnlistenFn[] = [];
let sharedDestroyed = false;
let sharedUnsubWorkspace: (() => void) | null = null;
let listenerGeneration = 0;

function addSharedListener<T>(
  event: string,
  handler: (e: Event<T>) => void,
): void {
  const gen = listenerGeneration;
  listen<T>(event, handler).then((fn) => {
    if (sharedDestroyed || listenerGeneration !== gen) {
      fn();
    } else {
      sharedUnlisteners.push(fn);
    }
  });
}

export function acquireInvalidationListeners(): void {
  listenerRefCount++;
  if (listenerRefCount > 1) return; // already registered

  sharedDestroyed = false;
  listenerGeneration++;

  // Graph-updated listener
  addSharedListener<unknown>("lit:graph-updated", () => {
    invalidateBibKeyStatesCache();
  });

  // .bib file change listeners
  for (const eventName of [
    "workspace://file-created",
    "workspace://file-modified",
    "workspace://file-deleted",
  ] as const) {
    addSharedListener<{ path: string }>(
      eventName,
      (event) => {
        if (event.payload.path.toLowerCase().endsWith(".bib")) {
          invalidateBibKeyStatesCache();
        }
      },
    );
  }

  // Workspace switch invalidation
  let lastPath = useWorkspaceStore.getState().workspacePath;
  sharedUnsubWorkspace = useWorkspaceStore.subscribe((state) => {
    if (state.workspacePath !== lastPath) {
      lastPath = state.workspacePath;
      invalidateBibKeyStatesCache();
    }
  });
}

export function releaseInvalidationListeners(): void {
  listenerRefCount--;
  if (listenerRefCount > 0) return; // other views still alive

  sharedDestroyed = true;
  for (const fn of sharedUnlisteners) fn();
  sharedUnlisteners = [];
  sharedUnsubWorkspace?.();
  sharedUnsubWorkspace = null;
}

/** @internal -- test-only */
export function _resetSharedListenersForTest(): void {
  sharedDestroyed = true;
  for (const fn of sharedUnlisteners) fn();
  sharedUnlisteners = [];
  sharedUnsubWorkspace?.();
  sharedUnsubWorkspace = null;
  listenerRefCount = 0;
  sharedDestroyed = false;
}

/* ── Tauri event listener (thin ViewPlugin) ───────────────── */

const citeprocTooltipListener = ViewPlugin.fromClass(
  class {
    constructor(_view: EditorView) {
      acquireInvalidationListeners();
    }
    update(_update: ViewUpdate) {}
    destroy() {
      releaseInvalidationListeners();
    }
  },
);

/* ── Public extension ───────────────────────────────────────── */

export function citeprocTooltipExtension(): Extension {
  return [
    citeprocHoverTracker,
    hoverTooltip(citeprocTooltipSource, { hideOnChange: true }),
    citeprocTooltipListener,
  ];
}
