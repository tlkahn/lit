import { codeFolding, foldGutter, foldKeymap, foldService, syntaxTree } from "@codemirror/language";
import { EditorView, keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { FoldingShowControls } from "../stores/preferences";

const frontmatterFold = foldService.of((state, lineStart, lineEnd) => {
  const tree = syntaxTree(state);
  const node = tree.resolveInner(lineStart, 1);
  if (node.name === "Frontmatter" && node.from === lineStart) {
    return { from: lineEnd, to: node.to };
  }
  return null;
});

function chevronMarker(open: boolean): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = "cm-fold-marker";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", open ? "M4 6 8 10 12 6" : "M6 4 10 8 6 12");
  svg.appendChild(path);
  wrapper.appendChild(svg);
  return wrapper;
}

const placeholderTheme = EditorView.baseTheme({
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--background-secondary, rgba(0,0,0,0.05))",
    border: "1px solid var(--background-modifier-border, #e0e0e0)",
    borderRadius: "4px",
    padding: "0 4px",
    margin: "0 4px",
    color: "var(--text-faint)",
    fontSize: "0.8em",
    cursor: "pointer",
  },
});

const gutterBaseTheme = EditorView.baseTheme({
  ".cm-foldGutter": {
    width: "16px",
  },
  ".cm-foldGutter .cm-gutterElement": {
    padding: "0",
    cursor: "pointer",
    color: "var(--text-faint)",
  },
  ".cm-foldGutter .cm-gutterElement .cm-fold-marker": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
  ".cm-foldGutter .cm-gutterElement .cm-fold-marker svg": {
    width: "16px",
    height: "16px",
  },
});

const gutterAlwaysTheme = EditorView.baseTheme({
  ".cm-foldGutter .cm-gutterElement": { opacity: "1" },
});

const gutterMouseoverTheme = EditorView.baseTheme({
  ".cm-foldGutter .cm-gutterElement": {
    opacity: "0",
    transition: "opacity 150ms ease",
  },
  ".cm-gutters:hover .cm-foldGutter .cm-gutterElement": {
    opacity: "1",
  },
});

export interface FoldConfig {
  enabled: boolean;
  showControls: FoldingShowControls;
}

export function foldExtension(config: FoldConfig = { enabled: true, showControls: "mouseover" }): Extension {
  if (!config.enabled) return [];

  const showGutter = config.showControls !== "never";

  return [
    codeFolding({ placeholderText: "···" }),
    keymap.of(foldKeymap),
    frontmatterFold,
    placeholderTheme,
    ...(showGutter
      ? [
          foldGutter({ markerDOM: chevronMarker }),
          gutterBaseTheme,
          config.showControls === "always" ? gutterAlwaysTheme : gutterMouseoverTheme,
        ]
      : []),
  ];
}
