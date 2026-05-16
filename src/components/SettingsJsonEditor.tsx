import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
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

export function SettingsJsonEditor({ initialJson }: SettingsJsonEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialJson,
        extensions: [
          json(),
          getThemeExtension(detectTheme()),
          EditorView.editable.of(true),
        ],
      }),
      parent,
    });

    return () => view.destroy();
  }, [initialJson]);

  return <div ref={containerRef} data-testid="settings-json-editor" />;
}
