import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * Tracks Meta/Control key state and toggles `cm-mod-held` on the editor DOM.
 * Shared by `bibFileLink` and `citationClickHandler` to enable
 * hover-while-holding-modifier visual affordances.
 */
export const modKeyTracker = ViewPlugin.fromClass(
  class {
    private onKeyDown: (e: KeyboardEvent) => void;
    private onKeyUp: (e: KeyboardEvent) => void;
    private onBlur: () => void;

    constructor(private view: EditorView) {
      this.onKeyDown = (e) => {
        if (e.key === "Meta" || e.key === "Control") {
          this.view.dom.classList.add("cm-mod-held");
        }
      };
      this.onKeyUp = (e) => {
        if (e.key === "Meta" || e.key === "Control") {
          this.view.dom.classList.remove("cm-mod-held");
        }
      };
      this.onBlur = () => {
        this.view.dom.classList.remove("cm-mod-held");
      };

      document.addEventListener("keydown", this.onKeyDown);
      document.addEventListener("keyup", this.onKeyUp);
      window.addEventListener("blur", this.onBlur);
    }

    update(_update: ViewUpdate) {}

    destroy() {
      document.removeEventListener("keydown", this.onKeyDown);
      document.removeEventListener("keyup", this.onKeyUp);
      window.removeEventListener("blur", this.onBlur);
      this.view.dom.classList.remove("cm-mod-held");
    }
  },
);

/**
 * Returns a `baseTheme` extension that underlines the given link class
 * when the modifier key is held (`cm-mod-held`).
 */
export function modHeldLinkStyle(className: string): Extension {
  return EditorView.baseTheme({
    [`&.cm-mod-held .${className}`]: {
      textDecoration: "underline",
      cursor: "pointer",
      color: "var(--text-accent)",
    },
  });
}
