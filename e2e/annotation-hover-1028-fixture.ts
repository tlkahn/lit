import type { Annotation } from "../src/lib/ipc";

// Single source for the issue #1028 e2e fixture. Imported by both the harness
// (runs in the browser via the dev server) and the spec (runs in Node via
// Playwright) so DOC / annotation offsets / expected scope text never diverge.
export const DOC = [
  "First term alpha appears here.",
  "",
  '<!--- n: ^"alpha"',
  "---",
  "note about alpha",
  "--->",
  "",
  "Second term beta appears here.",
  "",
  '<!--- n: ^"beta"',
  "---",
  "note about beta",
  "--->",
].join("\n");

// Offsets verified against the real lit-annotation-core parser:
const ANN1_START = DOC.indexOf('<!--- n: ^"alpha"');
const ANN1_END = ANN1_START + '<!--- n: ^"alpha"\n---\nnote about alpha\n--->'.length;
const ANN2_START = DOC.indexOf('<!--- n: ^"beta"');
const ANN2_END = ANN2_START + '<!--- n: ^"beta"\n---\nnote about beta\n--->'.length;

// Real parser output for this fixture: both block headers are compact-style
// (`n: ^"alpha"`), which the block grammar does not recognize, so scope falls
// back to the default Sentence(1) and the block is unstructured.
export const PARSED_ANNOTATIONS: Annotation[] = [
  {
    form: "block",
    annotation_type: "note",
    certainty: "neutral",
    scope: { kind: "sentence", value: 1 },
    body: "note about alpha",
    date: null,
    is_structured: false,
    char_start: ANN1_START,
    char_end: ANN1_END,
    original: DOC.slice(ANN1_START, ANN1_END),
  },
  {
    form: "block",
    annotation_type: "note",
    certainty: "neutral",
    scope: { kind: "sentence", value: 1 },
    body: "note about beta",
    date: null,
    is_structured: false,
    char_start: ANN2_START,
    char_end: ANN2_END,
    original: DOC.slice(ANN2_START, ANN2_END),
  },
];

// Sentence-1 backward resolution scope text for each annotation (what the
// `.scope-highlight` DOM marks), matching the stub's resolveScope.
export const EXPECTED_SCOPE = {
  ann1: "First term alpha appears here.",
  ann2: "Second term beta appears here.",
};

export interface IpcStubOpts {
  resolveDelayMs?: number;
}

/**
 * Builds the Tauri IPC stub source as a self-executing script string for
 * Playwright `addInitScript`. Closes over the same DOC / PARSED_ANNOTATIONS as
 * the harness, so the stub cannot drift from the fixture.
 */
export function buildTauriIpcStubSource(opts: IpcStubOpts = {}): string {
  const resolveDelayMs = opts.resolveDelayMs ?? 60;
  // JSON string literals embed the fixture data without a second handwritten
  // copy of the doc or annotation offsets.
  const docLiteral = JSON.stringify(DOC);
  const annotationsLiteral = JSON.stringify(PARSED_ANNOTATIONS);
  return `(function () {
  const DOC = ${docLiteral};
  const PARSED_ANNOTATIONS = ${annotationsLiteral};

  function parseAnnotations() {
    return PARSED_ANNOTATIONS;
  }

  function resolveScope(content, charStart, scope) {
    if (scope.kind === "sentence" && scope.value === 1) {
      const textBefore = content.slice(0, charStart).trimEnd();
      if (!textBefore.length) return null;
      const paragraphs = textBefore.split(/\\n\\n+/);
      const last = paragraphs[paragraphs.length - 1] ?? "";
      const end = textBefore.length;
      let start = end - last.length;
      while (start < end && /\\s/.test(content[start])) start++;
      return { start, end };
    }
    if (scope.kind === "anchor") {
      const textBefore = content.slice(0, charStart);
      const pos = textBefore.lastIndexOf(scope.value);
      if (pos === -1) return null;
      return { start: pos, end: pos + scope.value.length };
    }
    return null;
  }

  const callbacks = new Map();
  let callbackId = 0;
  const listeners = new Map();

  window.__TAURI_INTERNALS__ = {
    invoke: function (cmd, args) {
      if (cmd === "plugin:event|listen") {
        const id = callbackId++;
        listeners.set(args?.event || "unknown", id);
        return Promise.resolve(id);
      }
      if (cmd === "plugin:event|unlisten") return Promise.resolve();
      if (cmd === "parse_annotations") return Promise.resolve(parseAnnotations());
      if (cmd === "list_annotations") return Promise.resolve([]);
      if (cmd === "resolve_annotation_scope") {
        // Simulate real IPC latency.
        return new Promise((res) => {
          setTimeout(() => res(resolveScope(args.content, args.charStart, args.scope)), ${resolveDelayMs});
        });
      }
      if (cmd === "resolve_annotation_scope_with_mode") {
        return new Promise((res) => {
          setTimeout(() => res(resolveScope(args.content, args.charStart, args.scope)), ${resolveDelayMs});
        });
      }
      return Promise.resolve(null);
    },
    transformCallback: function (cb, once) {
      const id = callbackId++;
      callbacks.set(id, { cb, once: !!once });
      return id;
    },
    convertFileSrc: function (path) {
      return "asset://localhost/" + encodeURIComponent(path);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: function () {} };
})();`;
}
