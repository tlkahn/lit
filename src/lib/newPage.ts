import { getNextUntitledName } from "./naming";
import { useWorkspaceStore } from "../stores/workspace";

let queue: Promise<void> = Promise.resolve();

/** @internal test isolation */
export function _resetCreateUntitledPageQueueForTesting(): void {
  queue = Promise.resolve();
}

/** Create the next Untitled / Untitled N page in the open workspace. */
export function createUntitledPage(): Promise<void> {
  const run = queue.then(async () => {
    const state = useWorkspaceStore.getState();
    if (state.workspacePath == null) return;
    const name = getNextUntitledName(state.pages);
    await state.createPage(name);
  });
  // Keep the chain alive if a link throws; callers still observe run's settlement.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
