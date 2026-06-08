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
      const customDef = prefs.llmProvider.providerId.startsWith("custom-")
        ? prefs.llmCustomProviders.find((p) => p.id === prefs.llmProvider.providerId)
        : undefined;
      return {
        provider: prefs.llmProvider.providerId,
        model: prefs.llmProvider.model,
        text,
        system: system || undefined,
        baseUrl: prefs.llmProvider.baseUrl,
        contextWindow: customDef?.contextWindow,
      };
    },
    onDone: ({ responseText, markFiringCleared, liveRange }) => {
      try {
        const threadDsl = buildThreadDsl(annotation, responseText);
        const liveDoc = view.state.doc;
        const startLine = liveDoc.lineAt(liveRange.from);
        const atColumn0 = liveRange.from === startLine.from;
        const endLine = liveDoc.lineAt(liveRange.to);
        const trailing = liveDoc.sliceString(liveRange.to, endLine.to);
        const hasTrailing = trailing.trim().length > 0;
        const insert =
          (atColumn0 ? "" : "\n") + threadDsl + (hasTrailing ? "\n" : "");
        const changes = view.state.changes({
          from: liveRange.from,
          to: liveRange.to,
          insert,
        });
        const mapped = changes.mapPos(liveRange.from, 1);
        view.dispatch({ changes, effects: clearFiringAnnotation.of(mapped) });
        markFiringCleared();
      } catch { /* view destroyed */ }
    },
  });
}
