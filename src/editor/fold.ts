import { codeFolding, foldGutter, foldKeymap, foldService, syntaxTree } from "@codemirror/language";
import { keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

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

export function foldExtension(): Extension {
  return [
    codeFolding({ placeholderText: "···" }),
    foldGutter({ markerDOM: chevronMarker }),
    keymap.of(foldKeymap),
    frontmatterFold,
  ];
}
