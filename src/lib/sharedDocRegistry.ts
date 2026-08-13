// Generic shared-document registry.
//
// Both the markdown (sharedDocs.ts) and source-code (sharedCodeDocs.ts) stacks
// need the exact same machinery: pane refcounting (acquire/release), a pub/sub
// surface (subscribe / subscribeSaveSettled / subscribeContentReload), reload
// coordination, and a debounced save scheduler with a release->acquire race
// fix. The two differed only in (a) content shape — markdown carries
// frontmatter+rawYaml, code does not — and (b) the write IPC call. This module
// factors out the common core, parameterized by the content shape `Content`
// and a `write(path, doc)` function, so the save algorithm (and its race fix)
// lives in exactly one place.

// Registry bookkeeping fields that are independent of the content shape.
export interface BaseSharedDoc<Content> {
  panes: Set<string>;
  loaded: boolean;
  subscribers: Map<string, (newBody: string, fromPaneId: string) => void>;
  saveSettledSubscribers: Map<string, (isDirty: boolean) => void>;
  contentReloadSubscribers: Map<string, (content: Content) => void>;
  reloadInFlight: boolean;
  saveTimer?: ReturnType<typeof setTimeout>;
  // Promise for the currently in-flight write, or null when idle. Lets
  // release() chain a deferred registry delete onto the actual save
  // settlement instead of guessing with a one-shot microtask.
  saveInFlight: Promise<void> | null;
  editGen: number;
  saveGen: number;
  saveInFlightGen: number;
}

// The concrete doc carries the registry bookkeeping plus the module's content
// fields (e.g. body/title for code, body/title/frontmatter/rawYaml for
// markdown). Content keys are disjoint from the bookkeeping keys above, so the
// generic core can copy content with a plain Object.assign without clobbering
// bookkeeping state.
export type SharedDocOf<Content> = BaseSharedDoc<Content> & Content;

// Every Content shape used here has at least a `body: string` field; the save
// path and setBody rely on it.
interface HasBody {
  body: string;
}

export interface SharedDocRegistryConfig<Content extends HasBody> {
  // Persist the doc. Receives the whole doc so the write can pull whatever
  // content fields it needs (body, frontmatter, ...). MUST forward exactly the
  // args the underlying IPC expects — callers assert on arity.
  write: (pagePath: string, doc: SharedDocOf<Content>) => Promise<void>;
  // Content fields for a fresh, unloaded doc.
  initContent: () => Content;
}

export interface SharedDocRegistry<Content extends HasBody> {
  acquire: (pagePath: string, paneId: string) => void;
  release: (pagePath: string, paneId: string) => void;
  getPaneIds: (pagePath: string) => string[];
  getDoc: (pagePath: string) => SharedDocOf<Content> | null;
  setContent: (pagePath: string, content: Content) => void;
  setBody: (pagePath: string, newBody: string, fromPaneId: string) => void;
  renamePath: (oldPath: string, newPath: string, patch?: Partial<Content>) => void;
  isShared: (pagePath: string) => boolean;
  isDirty: (pagePath: string) => boolean;
  subscribe: (
    pagePath: string,
    paneId: string,
    cb: (newBody: string, fromPaneId: string) => void,
  ) => () => void;
  subscribeSaveSettled: (
    pagePath: string,
    paneId: string,
    cb: (isDirty: boolean) => void,
  ) => () => void;
  subscribeContentReload: (
    pagePath: string,
    paneId: string,
    cb: (content: Content) => void,
  ) => () => void;
  startReload: (pagePath: string) => boolean;
  finishReload: (
    pagePath: string,
    content: Content,
    fromPaneId: string,
  ) => void;
  cancelReload: (pagePath: string) => void;
  _resetForTesting: () => void;
}

const SAVE_DEBOUNCE_MS = 300;

export function createSharedDocRegistry<Content extends HasBody>(
  config: SharedDocRegistryConfig<Content>,
): SharedDocRegistry<Content> {
  // Each registry owns its OWN Map so the two stacks stay fully isolated.
  const docs = new Map<string, SharedDocOf<Content>>();
  let epoch = 0;

  function acquire(pagePath: string, paneId: string): void {
    let doc = docs.get(pagePath);
    if (!doc) {
      const base: BaseSharedDoc<Content> = {
        panes: new Set(),
        loaded: false,
        subscribers: new Map(),
        saveSettledSubscribers: new Map(),
        contentReloadSubscribers: new Map(),
        reloadInFlight: false,
        saveInFlight: null,
        editGen: 0,
        saveGen: 0,
        saveInFlightGen: 0,
      };
      doc = Object.assign(base, config.initContent()) as SharedDocOf<Content>;
      docs.set(pagePath, doc);
    }
    doc.panes.add(paneId);
  }

  function notifySaveSettled(doc: SharedDocOf<Content>): void {
    const stillDirty = doc.editGen > doc.saveGen;
    for (const cb of doc.saveSettledSubscribers.values()) {
      cb(stillDirty);
    }
  }

  function executeSave(
    pagePath: string,
    doc: SharedDocOf<Content>,
  ): Promise<void> {
    const genAtSave = doc.editGen;
    doc.saveInFlightGen = genAtSave;
    const p = config
      .write(pagePath, doc)
      .then(() => {
        if (doc.editGen === genAtSave) {
          doc.saveGen = genAtSave;
        }
        if (doc.saveInFlightGen === genAtSave) {
          doc.saveInFlightGen = 0;
        }
        if (doc.saveInFlight === p) doc.saveInFlight = null;
        notifySaveSettled(doc);
      })
      .catch(() => {
        if (doc.saveInFlightGen === genAtSave) {
          doc.saveInFlightGen = 0;
        }
        if (doc.saveInFlight === p) doc.saveInFlight = null;
        notifySaveSettled(doc);
      });
    doc.saveInFlight = p;
    return p;
  }

  function scheduleSave(pagePath: string, doc: SharedDocOf<Content>): void {
    if (doc.saveTimer) clearTimeout(doc.saveTimer);
    doc.saveTimer = setTimeout(() => {
      doc.saveTimer = undefined;
      executeSave(pagePath, doc);
    }, SAVE_DEBOUNCE_MS);
  }

  function release(pagePath: string, paneId: string): void {
    const doc = docs.get(pagePath);
    if (!doc) return;
    doc.panes.delete(paneId);
    doc.subscribers.delete(paneId);
    doc.saveSettledSubscribers.delete(paneId);
    doc.contentReloadSubscribers.delete(paneId);
    if (doc.panes.size === 0) {
      if (doc.saveTimer) {
        clearTimeout(doc.saveTimer);
        doc.saveTimer = undefined;
      }
      // Delete the doc from the registry, but only once it is truly idle:
      // - identity guard (`live === doc`): never delete a doc that has been
      //   replaced by a later, legitimate full GC + re-acquire.
      // - pane guard (`panes.size === 0`): never delete a re-acquired doc.
      // - in-flight guard (`saveInFlightGen === 0`): never delete while a save
      //   is still pending (a setBody during the window may have queued one).
      const releaseEpoch = epoch;
      const maybeDelete = (): void => {
        if (releaseEpoch !== epoch) return;
        const live = docs.get(pagePath);
        if (
          live === doc &&
          live.panes.size === 0 &&
          live.saveInFlightGen === 0
        ) {
          docs.delete(pagePath);
        }
      };
      if (doc.editGen > Math.max(doc.saveGen, doc.saveInFlightGen)) {
        // Defer the delete until the in-flight write settles, keeping the doc
        // (with its loaded flag + edited body) in the registry. A concurrent
        // acquire() for the same path then reuses the in-memory body instead of
        // creating a fresh empty doc that would read stale on-disk bytes.
        void executeSave(pagePath, doc).then(maybeDelete, maybeDelete);
      } else if (doc.saveInFlight) {
        // No fresh edits to flush, but a previously-scheduled save is still in
        // flight. Defer the delete until it settles so the entry doesn't leak
        // and a concurrent re-acquire reuses the live doc.
        void doc.saveInFlight.then(maybeDelete, maybeDelete);
      } else {
        docs.delete(pagePath);
      }
    }
  }

  function getPaneIds(pagePath: string): string[] {
    const doc = docs.get(pagePath);
    return doc ? [...doc.panes] : [];
  }

  function getDoc(pagePath: string): SharedDocOf<Content> | null {
    return docs.get(pagePath) ?? null;
  }

  function setContent(pagePath: string, content: Content): void {
    const doc = docs.get(pagePath);
    if (!doc) return;
    Object.assign(doc, content);
    doc.loaded = true;
  }

  function setBody(
    pagePath: string,
    newBody: string,
    fromPaneId: string,
  ): void {
    const doc = docs.get(pagePath);
    if (!doc) return;
    doc.body = newBody;
    doc.editGen++;
    for (const [paneId, cb] of doc.subscribers) {
      if (paneId !== fromPaneId) cb(newBody, fromPaneId);
    }
    scheduleSave(pagePath, doc);
  }

  function renamePath(
    oldPath: string,
    newPath: string,
    patch?: Partial<Content>,
  ): void {
    if (oldPath === newPath) return;
    const doc = docs.get(oldPath);
    if (!doc) return;

    // Migrate any armed debounce off the old path before rekeying. A timer
    // closed over oldPath would otherwise writePage(oldPath) after the rename
    // and resurrect the old file.
    if (doc.saveTimer) {
      clearTimeout(doc.saveTimer);
      doc.saveTimer = undefined;
    }

    docs.delete(oldPath);
    if (patch) Object.assign(doc, patch);
    // If newPath already has a doc (should not happen on successful rename),
    // prefer the moved in-memory doc and drop the empty placeholder.
    docs.set(newPath, doc);

    // Re-arm the save against the new path when the doc is still dirty. A
    // dirty doc always had a timer (setBody schedules one), so this covers the
    // cleared-timer case. In-flight writes are chained by the caller when they
    // settle (see renamePath callers / Cycle 2 follow-up).
    if (!doc.saveInFlight && doc.editGen > doc.saveGen) {
      scheduleSave(newPath, doc);
    }
  }

  function isShared(pagePath: string): boolean {
    const doc = docs.get(pagePath);
    return (doc?.panes.size ?? 0) > 1;
  }

  function isDirty(pagePath: string): boolean {
    const doc = docs.get(pagePath);
    if (!doc) return false;
    return doc.editGen > doc.saveGen;
  }

  function subscribe(
    pagePath: string,
    paneId: string,
    cb: (newBody: string, fromPaneId: string) => void,
  ): () => void {
    const doc = docs.get(pagePath);
    if (!doc) return () => {};
    doc.subscribers.set(paneId, cb);
    return () => {
      doc.subscribers.delete(paneId);
    };
  }

  function subscribeSaveSettled(
    pagePath: string,
    paneId: string,
    cb: (isDirty: boolean) => void,
  ): () => void {
    const doc = docs.get(pagePath);
    if (!doc) return () => {};
    doc.saveSettledSubscribers.set(paneId, cb);
    return () => {
      doc.saveSettledSubscribers.delete(paneId);
    };
  }

  function subscribeContentReload(
    pagePath: string,
    paneId: string,
    cb: (content: Content) => void,
  ): () => void {
    const doc = docs.get(pagePath);
    if (!doc) return () => {};
    doc.contentReloadSubscribers.set(paneId, cb);
    return () => {
      doc.contentReloadSubscribers.delete(paneId);
    };
  }

  function startReload(pagePath: string): boolean {
    const doc = docs.get(pagePath);
    if (!doc || doc.reloadInFlight) return false;
    doc.reloadInFlight = true;
    return true;
  }

  function finishReload(
    pagePath: string,
    content: Content,
    fromPaneId: string,
  ): void {
    const doc = docs.get(pagePath);
    if (!doc) return;
    doc.reloadInFlight = false;
    setContent(pagePath, content);
    for (const [paneId, cb] of doc.contentReloadSubscribers) {
      if (paneId !== fromPaneId) cb(content);
    }
  }

  function cancelReload(pagePath: string): void {
    const doc = docs.get(pagePath);
    if (!doc) return;
    doc.reloadInFlight = false;
  }

  function _resetForTesting(): void {
    for (const doc of docs.values()) {
      if (doc.saveTimer) clearTimeout(doc.saveTimer);
    }
    docs.clear();
    epoch++;
  }

  return {
    acquire,
    release,
    getPaneIds,
    getDoc,
    setContent,
    setBody,
    renamePath,
    isShared,
    isDirty,
    subscribe,
    subscribeSaveSettled,
    subscribeContentReload,
    startReload,
    finishReload,
    cancelReload,
    _resetForTesting,
  };
}
