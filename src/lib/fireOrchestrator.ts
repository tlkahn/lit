import type { EditorView } from "@codemirror/view";
import type { Annotation, AnnotationType } from "./ipc";
import { resolveAnnotationScopeWithMode } from "./ipc";
import { canFire } from "./fireClassification";
import { usePreferencesStore, type PreferencesState } from "../stores/preferences";
import { clearFiringAnnotation } from "../editor/livePreview/annotationWidgets";
import { buildThreadDsl } from "./companionInsert";
import { withLlmStream } from "./withLlmStream";

export interface FireAnnotationArgs {
  view: EditorView;
  annotation: Annotation;
}

const PROMPT_FIELD_MAP: Partial<Record<AnnotationType, keyof PreferencesState>> = {
  llm: "llmPromptLlm",
  translation: "llmPromptTr",
  question: "llmPromptQ",
};

export function getTypePrompt(annotationType: AnnotationType): string {
  const field = PROMPT_FIELD_MAP[annotationType];
  if (!field) return "";
  return (usePreferencesStore.getState()[field] as string) ?? "";
}

export function stripAnnotations(text: string): string {
  return text
    .replace(/<!---[\s\S]*?--->/g, "")
    .replace(/%%![\s\S]*?%%/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function buildFirePrompt(scopeText: string, body: string | null): string {
  const parts: string[] = [];
  if (scopeText) parts.push(scopeText);
  if (body) parts.push(body);
  return parts.join("\n\n");
}

export async function fireAnnotation(args: FireAnnotationArgs): Promise<void> {
  const { view, annotation } = args;

  const prefs = usePreferencesStore.getState();
  const doc = view.state.doc.toString();
  const lang = prefs.annotationDefaultLang;

  return withLlmStream(view, annotation, {
    buildArgs: async ({ isCancelled }) => {
      if (!canFire(annotation.annotation_type)) return null;

      let scopeText = "";
      try {
        const range = await resolveAnnotationScopeWithMode(
          doc,
          annotation.char_start,
          annotation.scope,
          lang,
          "bidirectional",
        );
        if (range) {
          scopeText = stripAnnotations(doc.slice(range.start, range.end));
        }
      } catch (err) {
        console.warn("Scope resolution failed, proceeding with empty scope:", err);
      }
      if (isCancelled()) return null;

      const system = getTypePrompt(annotation.annotation_type);
      const text = buildFirePrompt(scopeText, annotation.body);
      return { model: prefs.llmModel, text, system: system || undefined };
    },
    onDone: ({ responseText, markFiringCleared }) => {
      try {
        const threadDsl = buildThreadDsl(annotation, responseText);
        // The thread DSL may be block-form (multi-line). The block parser
        // requires the opening `<!---` at column 0 and the closing `--->`
        // as the last token on its line. If the source annotation was
        // inline (mid-line) or had trailing text, splicing the DSL in place
        // would leave the opening mid-line and/or the trailing text on the
        // close line — neither parser would recognize it, so the thread
        // would be invisible in live preview. Split the line so the DSL
        // always begins at column 0 and the close line ends at `--->`.
        const liveDoc = view.state.doc;
        const startLine = liveDoc.lineAt(annotation.char_start);
        const atColumn0 = annotation.char_start === startLine.from;
        const endLine = liveDoc.lineAt(annotation.char_end);
        const trailing = liveDoc.sliceString(annotation.char_end, endLine.to);
        const hasTrailing = trailing.trim().length > 0;
        const insert =
          (atColumn0 ? "" : "\n") + threadDsl + (hasTrailing ? "\n" : "");
        // Clear the firing spinner in the SAME transaction as the doc
        // replacement, keyed off the post-remap position. firingAnnotationsField
        // remaps existing entries first, then applies effects — so clearing the
        // mapped position deletes the entry the remap just produced, never a
        // stale one. (For a replacement whose `from` is the firing position the
        // mapped position equals char_start, but computing it explicitly keeps
        // this correct even if the change ever becomes a pure insert.)
        const changes = view.state.changes({
          from: annotation.char_start,
          to: annotation.char_end,
          insert,
        });
        const mapped = changes.mapPos(annotation.char_start, 1);
        view.dispatch({ changes, effects: clearFiringAnnotation.of(mapped) });
        markFiringCleared();
      } catch { /* view destroyed */ }
    },
  });
}
