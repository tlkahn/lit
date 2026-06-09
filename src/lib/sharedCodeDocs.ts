import { writeCodeFile } from "./ipc";
import {
  createSharedDocRegistry,
  type SharedDocOf,
} from "./sharedDocRegistry";

export interface SharedCodeContent {
  body: string;
  title: string;
}

export type SharedCodeDoc = SharedDocOf<SharedCodeContent>;

// Separate registry instance from the markdown sharedDocs so the two stacks are
// fully isolated. file_type routing prevents the same path opening in both. The
// only module-specific bits are the content shape (no frontmatter) and the
// writeCodeFile IPC call (exactly two args — no frontmatter).
const registry = createSharedDocRegistry<SharedCodeContent>({
  write: (pagePath, doc) => writeCodeFile(pagePath, doc.body),
  initContent: () => ({ body: "", title: "" }),
});

export const acquire = registry.acquire;
export const release = registry.release;
export const getPaneIds = registry.getPaneIds;
export const getDoc = registry.getDoc;
export const setContent = registry.setContent;
export const setBody = registry.setBody;
export const isShared = registry.isShared;
export const isDirty = registry.isDirty;
export const subscribe = registry.subscribe;
export const subscribeSaveSettled = registry.subscribeSaveSettled;
export const subscribeContentReload = registry.subscribeContentReload;
export const startReload = registry.startReload;
export const finishReload = registry.finishReload;
export const cancelReload = registry.cancelReload;
export const _resetForTesting = registry._resetForTesting;
