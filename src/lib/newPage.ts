import { getNextUntitledName } from "./naming";
import { useWorkspaceStore } from "../stores/workspace";

/** Create the next Untitled / Untitled N page in the open workspace. */
export function createUntitledPage(): Promise<void> | void {
  const state = useWorkspaceStore.getState();
  if (state.workspacePath == null) return;
  const name = getNextUntitledName(state.pages);
  return state.createPage(name);
}
