import { writePage } from "./ipc";
import {
  createSharedDocRegistry,
  type SharedDocOf,
} from "./sharedDocRegistry";

export interface SharedDocContent {
  body: string;
  title: string;
  frontmatter: Record<string, unknown>;
  rawYaml: string;
}

export type SharedDoc = SharedDocOf<SharedDocContent>;

// Separate registry instance (its own docs Map) from the source-code stack so
// the two are fully isolated. The only module-specific bits are the content
// shape (frontmatter + rawYaml) and the writePage IPC call.
const registry = createSharedDocRegistry<SharedDocContent>({
  write: (pagePath, doc) => writePage(pagePath, doc.body, doc.frontmatter),
  initContent: () => ({ body: "", title: "", frontmatter: {}, rawYaml: "" }),
});

export const acquire = registry.acquire;
export const release = registry.release;
export const getPaneIds = registry.getPaneIds;
export const getDoc = registry.getDoc;
export const setContent = registry.setContent;
export const setBody = registry.setBody;
export const renamePath = registry.renamePath;
export const flushSave = registry.flushSave;
export const isShared = registry.isShared;
export const isDirty = registry.isDirty;
export const subscribe = registry.subscribe;
export const subscribeSaveSettled = registry.subscribeSaveSettled;
export const subscribeContentReload = registry.subscribeContentReload;
export const startReload = registry.startReload;
export const finishReload = registry.finishReload;
export const cancelReload = registry.cancelReload;
export const _resetForTesting = registry._resetForTesting;
