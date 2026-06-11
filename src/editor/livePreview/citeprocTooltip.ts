import { type Extension, StateEffect, StateField } from "@codemirror/state";
import {
  type EditorView,
  type Tooltip,
  showTooltip,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  getBibKeyStates,
  materializeCitation,
  type BibKeyState,
} from "../../lib/ipc";
import { useWorkspaceStore } from "../../stores/workspace";
import { useStatusMessageStore } from "../../stores/statusMessage";

interface CiteprocTooltipState {
  pos: number;
  bibKey: string;
}

export const setCiteprocTooltip =
  StateEffect.define<CiteprocTooltipState>();
export const clearCiteprocTooltip = StateEffect.define<void>();

let clearTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleClearTooltip(view: EditorView): void {
  clearTimer = setTimeout(() => {
    clearTimer = null;
    view.dispatch({ effects: clearCiteprocTooltip.of(undefined) });
  }, 150);
}

export function cancelClearTooltip(): void {
  if (clearTimer != null) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
}

let bibKeyStatesCache: Record<string, BibKeyState> | null = null;
let bibKeyStatesFetching: Promise<Record<string, BibKeyState>> | null = null;

function invalidateBibKeyStatesCache(): void {
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
  });
  return bibKeyStatesFetching;
}

function buildTooltipDom(
  bibKey: string,
  view: EditorView,
): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-citeproc-tooltip";

  dom.addEventListener("mouseenter", () => {
    cancelClearTooltip();
  });
  dom.addEventListener("mouseleave", () => {
    scheduleClearTooltip(view);
  });

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
        view.dispatch({ effects: clearCiteprocTooltip.of(undefined) });
      } else {
        btn.disabled = true;
        btn.textContent = "Creating…";
        materializeCitation(bibKey)
          .then((meta) => {
            const ws = useWorkspaceStore.getState();
            ws.selectPage(meta.relative_path);
            view.dispatch({ effects: clearCiteprocTooltip.of(undefined) });
          })
          .catch((err) => {
            btn.disabled = false;
            btn.textContent = "Create note";
            useStatusMessageStore
              .getState()
              .show(String(err), "error");
          });
      }
    });

    dom.appendChild(btn);
  });

  return dom;
}

const citeprocTooltipField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    if (tr.docChanged || tr.selection) return null;
    for (const e of tr.effects) {
      if (e.is(setCiteprocTooltip)) {
        const { pos, bibKey } = e.value;
        return {
          pos,
          above: true,
          create(view: EditorView) {
            return { dom: buildTooltipDom(bibKey, view) };
          },
        };
      }
      if (e.is(clearCiteprocTooltip)) return null;
    }
    return value;
  },
  provide: (f) => showTooltip.from(f),
});

const citeprocTooltipListener = ViewPlugin.fromClass(
  class {
    private unlisten: UnlistenFn | null = null;

    constructor(_view: EditorView) {
      listen("lit:graph-updated", () => {
        invalidateBibKeyStatesCache();
      }).then((fn) => {
        this.unlisten = fn;
      });
    }

    update(_update: ViewUpdate) {}

    destroy() {
      this.unlisten?.();
    }
  },
);

export function citeprocTooltipExtension(): Extension {
  return [citeprocTooltipField, citeprocTooltipListener];
}
