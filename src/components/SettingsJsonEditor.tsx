import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter } from "@codemirror/lint";
import { getThemeExtension } from "../editor/theme";

interface SettingsJsonEditorProps {
  initialJson: string;
  onSave: (json: string) => void;
}

function detectTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("theme-dark")
    ? "dark"
    : "light";
}

export function SettingsJsonEditor({
  initialJson,
  onSave,
}: SettingsJsonEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const [error, setError] = useState<string | null>(null);

  const doSave = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const doc = view.state.doc.toString();
    setError(null);
    try {
      JSON.parse(doc);
    } catch (e) {
      setError((e as SyntaxError).message);
      return;
    }
    onSaveRef.current(doc);
  }, []);

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialJson,
        extensions: [
          json(),
          linter(jsonParseLinter()),
          getThemeExtension(detectTheme()),
          EditorView.editable.of(true),
        ],
      }),
      parent,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [initialJson]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        doSave();
      }
    };
    container.addEventListener("keydown", handler);
    return () => container.removeEventListener("keydown", handler);
  }, [doSave]);

  return (
    <div>
      <div ref={containerRef} data-testid="settings-json-editor" />
      <button data-testid="settings-json-save" onClick={doSave}>
        Save
      </button>
      {error && (
        <div data-testid="settings-json-error">{error}</div>
      )}
    </div>
  );
}
