import { useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { createUntitledPage } from "../lib/newPage";

/** Create an untitled page when the native File > New Page menu item fires. */
export function useNewPageMenuListener() {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    getCurrentWebviewWindow()
      .listen("menu://new-page", () => {
        void createUntitledPage();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
