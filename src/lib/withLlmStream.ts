import type { EditorView } from "@codemirror/view";
import type { Annotation, LlmPromptStreamingArgs } from "./ipc";
import { startLlmStream, cancelLlmStream } from "./llmClient";
import { useModalLockStore } from "../stores/modalLock";
import { useStatusMessageStore } from "../stores/statusMessage";
import { useSecretStoreStore } from "../stores/secretStore";
import { setFiringAnnotation, clearFiringAnnotation } from "../editor/livePreview/annotationWidgets";

export interface WithLlmStreamOptions {
  /**
   * Construct the streaming args for this call site. Runs after the lock +
   * firing spinner are in place but before `ensureUnlocked`/streaming.
   *
   * - Return the {@link LlmPromptStreamingArgs} to stream.
   * - Return `null` to abort cleanly (cleanup runs, no stream is started).
   *   Used e.g. by `fireAnnotation` for its non-fireable early-return.
   *
   * `isCancelled()` reflects whether a `lit:cancel-fire` arrived during any
   * preceding await, letting builders that perform their own awaits
   * short-circuit. The harness also performs an authoritative `cancelled`
   * check immediately after this resolves.
   */
  buildArgs: (ctx: { isCancelled: () => boolean }) => Promise<LlmPromptStreamingArgs | null>;
  /**
   * Process a completed stream. Receives the accumulated `responseText`. Call
   * `markFiringCleared()` if the call site clears the firing spinner itself
   * (in the same transaction as its doc change) so the harness does not fire a
   * redundant fallback clear during cleanup.
   */
  onDone: (ctx: { responseText: string; markFiringCleared: () => void }) => void;
}

/**
 * Shared LLM streaming orchestration harness for {@link fireAnnotation} and
 * {@link threadFollowup}. Owns the entire lifecycle: lock acquisition, firing
 * spinner, `lit:fire-started`/`lit:fire-complete` events, cancel handling
 * (registered before any await so a cancel during setup is not dropped),
 * passphrase unlock, the stream try/catch, and teardown. The two call sites
 * differ only in prompt construction (`buildArgs`) and completion processing
 * (`onDone`), so those are the only injected hooks.
 */
export async function withLlmStream(
  view: EditorView,
  annotation: Annotation,
  opts: WithLlmStreamOptions,
): Promise<void> {
  if (useModalLockStore.getState().llmLocked) {
    throw new Error("LLM is already streaming");
  }

  let cleanedUp = false;
  let firingCleared = false;
  // Set by cancelHandler so the setup path (which yields at the buildArgs and
  // ensureUnlocked awaits below) can short-circuit before starting the stream
  // if a cancel arrived during one of those windows.
  let cancelled = false;
  const cancelHandler = () => {
    cancelled = true;
    cancelLlmStream().catch(console.error);
    doCleanup();
  };
  const doCleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    window.removeEventListener("lit:cancel-fire", cancelHandler);
    if (!firingCleared) {
      try {
        view.dispatch({ effects: clearFiringAnnotation.of(annotation.char_start) });
      } catch {
        /* view destroyed */
      }
    }
    useModalLockStore.getState().setLlmLocked(false);
    window.dispatchEvent(new CustomEvent("lit:fire-complete", { detail: { annotation } }));
  };

  // Register the cancel listener BEFORE showing the spinner / before any await,
  // so a cancel during setup (e.g. while parked on the passphrase modal) is not
  // dropped — otherwise the spinner stays and the LLM lock is held until the
  // stream completes/errors.
  window.addEventListener("lit:cancel-fire", cancelHandler);

  useModalLockStore.getState().setLlmLocked(true);
  view.dispatch({ effects: setFiringAnnotation.of(annotation.char_start) });
  window.dispatchEvent(new CustomEvent("lit:fire-started", { detail: { annotation } }));

  const args = await opts.buildArgs({ isCancelled: () => cancelled });
  if (cancelled) return;
  if (args === null) {
    doCleanup();
    return;
  }

  try {
    await useSecretStoreStore.getState().ensureUnlocked();
  } catch {
    doCleanup();
    return;
  }
  if (cancelled) return;

  let responseText = "";

  try {
    await startLlmStream(args, {
      onChunk: (chunk) => {
        responseText += chunk;
      },
      onDone: () => {
        opts.onDone({
          responseText,
          markFiringCleared: () => {
            firingCleared = true;
          },
        });
        doCleanup();
      },
      onError: (error) => {
        useStatusMessageStore.getState().show(error.message, "error");
        doCleanup();
      },
    });
  } catch (err) {
    useStatusMessageStore.getState().show(
      err instanceof Error ? err.message : "LLM stream failed",
      "error",
    );
    doCleanup();
  }
}
