import { useEffect } from "react";
import { usePreferencesStore } from "../stores/preferences";

const STYLE_ID = "lit-user-font-overrides";

const SYSTEM_FALLBACKS: Record<string, string> = {
  interface: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Noto Sans\", Helvetica, Arial, sans-serif",
  text: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Noto Sans\", Helvetica, Arial, sans-serif",
  monospace: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace",
};

function fontListToCss(fonts: string[]): string {
  return fonts.map((f) => (/[^a-zA-Z0-9-]/.test(f) ? `"${f}"` : f)).join(", ");
}

function buildCss(
  interfaceList: string[],
  textList: string[],
  monospaceList: string[],
  textSize: number,
): string {
  const rules: string[] = [];

  if (interfaceList.length > 0) {
    rules.push(`--font-interface-theme: ${fontListToCss(interfaceList)}, ${SYSTEM_FALLBACKS.interface} !important`);
  }
  if (textList.length > 0) {
    rules.push(`--font-text-theme: ${fontListToCss(textList)}, ${SYSTEM_FALLBACKS.text} !important`);
  }
  if (monospaceList.length > 0) {
    rules.push(`--font-monospace-theme: ${fontListToCss(monospaceList)}, ${SYSTEM_FALLBACKS.monospace} !important`);
  }
  rules.push(`--font-text-size: ${textSize}px`);

  return `:root { ${rules.join("; ")}; }`;
}

export function useFontOverrides() {
  const interfaceList = usePreferencesStore((s) => s.fontInterfaceList);
  const textList = usePreferencesStore((s) => s.fontTextList);
  const monospaceList = usePreferencesStore((s) => s.fontMonospaceList);
  const textSize = usePreferencesStore((s) => s.fontTextSize);

  useEffect(() => {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = buildCss(interfaceList, textList, monospaceList, textSize);

    return () => {
      el?.remove();
    };
  }, [interfaceList, textList, monospaceList, textSize]);
}
