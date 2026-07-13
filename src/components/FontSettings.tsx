import { useState, useCallback } from "react";
import { usePreferencesStore, setFontList, setFontTextSize } from "../stores/preferences";
import type { FontCategory } from "../stores/preferences";
import { FontManageDialog } from "./FontManageDialog";

const CATEGORIES: { key: FontCategory; label: string; description: string }[] = [
  { key: "interface", label: "Interface font", description: "Used for buttons, sidebars, and other UI elements." },
  { key: "text", label: "Text font", description: "Used for editing and reading notes in the editor." },
  { key: "monospace", label: "Monospace font", description: "Used for code blocks and inline code." },
];

function fontDisplayLabel(fonts: string[]): string {
  if (fonts.length === 0) return "Default";
  return fonts.join(", ");
}

export function FontSettings() {
  const interfaceList = usePreferencesStore((s) => s.fontInterfaceList);
  const textList = usePreferencesStore((s) => s.fontTextList);
  const monospaceList = usePreferencesStore((s) => s.fontMonospaceList);
  const textSize = usePreferencesStore((s) => s.fontTextSize);

  const [managingCategory, setManagingCategory] = useState<FontCategory | null>(null);

  const fontLists: Record<FontCategory, string[]> = {
    interface: interfaceList,
    text: textList,
    monospace: monospaceList,
  };

  const handleSave = useCallback((category: FontCategory, fonts: string[]) => {
    setFontList(category, fonts);
    setManagingCategory(null);
  }, []);

  return (
    <div data-testid="font-settings" className="space-y-4">
      <p className="text-xs text-text-muted">
        Manage fonts for different parts of the interface. Fonts are applied in order as a CSS font stack for per-script fallback.
      </p>

      {CATEGORIES.map(({ key, label, description }) => (
        <div key={key} className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-normal">{label}</div>
            <div className="text-xs text-text-muted mt-0.5">{description}</div>
            <div
              className="text-xs text-text-faint mt-0.5 truncate"
              style={fontLists[key].length > 0 ? { fontFamily: `"${fontLists[key][0]}", sans-serif` } : undefined}
            >
              {fontDisplayLabel(fontLists[key])}
            </div>
          </div>
          <button
            data-testid={`font-manage-${key}`}
            className="text-sm text-text-muted hover:text-text-normal px-2 py-0.5 rounded bg-bg-secondary"
            onClick={() => setManagingCategory(key)}
          >
            Manage
          </button>
        </div>
      ))}

      <div className="flex items-center gap-3 pt-1">
        <label className="text-sm text-text-normal flex-shrink-0">Font size</label>
        <input
          data-testid="font-size-slider"
          type="range"
          min={10}
          max={30}
          step={1}
          value={textSize}
          onChange={(e) => setFontTextSize(Number(e.target.value))}
          className="flex-1"
        />
        <span className="text-sm text-text-muted w-10 text-right">{textSize}px</span>
        {textSize !== 16 && (
          <button
            data-testid="font-size-reset"
            className="text-xs text-text-muted hover:text-text-normal"
            onClick={() => setFontTextSize(16)}
          >
            Reset
          </button>
        )}
      </div>

      {managingCategory && (
        <FontManageDialog
          category={managingCategory}
          fonts={fontLists[managingCategory]}
          onSave={(fonts) => handleSave(managingCategory, fonts)}
          onCancel={() => setManagingCategory(null)}
        />
      )}
    </div>
  );
}
