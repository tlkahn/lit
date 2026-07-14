import { afterEach } from "vitest";
import type { EditorView } from "@codemirror/view";

/**
 * Registers `view` for automatic teardown after the current test, even if
 * the test throws before a manual `view.destroy()` is reached.
 * `EditorView.destroy()` is idempotent, so this composes safely with any
 * existing manual `.destroy()` call at the end of a test body.
 *
 * Wrap the construction expression directly - the return value is the same
 * view instance, so this works regardless of what the caller does with it
 * (bare view, `{ view, parent }` bundle, etc.):
 *
 *   const view = trackView(new EditorView({ state, parent }));
 */
const pendingViews: EditorView[] = [];
let hookRegistered = false;

function ensureHookRegistered(): void {
  if (hookRegistered) return;
  hookRegistered = true;
  afterEach(() => {
    while (pendingViews.length > 0) {
      pendingViews.pop()!.destroy();
    }
  });
}

export function trackView<T extends EditorView>(view: T): T {
  ensureHookRegistered();
  pendingViews.push(view);
  return view;
}
