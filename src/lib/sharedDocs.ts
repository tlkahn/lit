import { writePage } from "./ipc";

export interface SharedDoc {
  panes: Set<string>;
  body: string;
  title: string;
  frontmatter: Record<string, unknown>;
  rawYaml: string;
  subscribers?: Map<string, (newBody: string, fromPaneId: string) => void>;
  saveTimer?: ReturnType<typeof setTimeout>;
  editGen: number;
  saveGen: number;
}

const docs = new Map<string, SharedDoc>();

export function acquire(pagePath: string, paneId: string): void {
  let doc = docs.get(pagePath);
  if (!doc) {
    doc = {
      panes: new Set(),
      body: "",
      title: "",
      frontmatter: {},
      rawYaml: "",
      editGen: 0,
      saveGen: 0,
    };
    docs.set(pagePath, doc);
  }
  doc.panes.add(paneId);
}

function executeSave(pagePath: string, doc: SharedDoc): void {
  const genAtSave = doc.editGen;
  writePage(pagePath, doc.body, doc.frontmatter).then(() => {
    if (doc.editGen === genAtSave) {
      doc.saveGen = genAtSave;
    }
  });
}

function flushSave(pagePath: string, doc: SharedDoc): void {
  if (doc.saveTimer) {
    clearTimeout(doc.saveTimer);
    doc.saveTimer = undefined;
  }
  executeSave(pagePath, doc);
}

function scheduleSave(pagePath: string, doc: SharedDoc): void {
  if (doc.saveTimer) clearTimeout(doc.saveTimer);
  doc.saveTimer = setTimeout(() => {
    doc.saveTimer = undefined;
    executeSave(pagePath, doc);
  }, 300);
}

export function release(pagePath: string, paneId: string): void {
  const doc = docs.get(pagePath);
  if (!doc) return;
  doc.panes.delete(paneId);
  doc.subscribers?.delete(paneId);
  if (doc.panes.size === 0) {
    if (doc.editGen > doc.saveGen) {
      flushSave(pagePath, doc);
    }
    docs.delete(pagePath);
  }
}

export function getPaneIds(pagePath: string): string[] {
  const doc = docs.get(pagePath);
  return doc ? [...doc.panes] : [];
}

export function getDoc(pagePath: string): SharedDoc | null {
  return docs.get(pagePath) ?? null;
}

export interface SharedDocContent {
  body: string;
  title: string;
  frontmatter: Record<string, unknown>;
  rawYaml: string;
}

export function setContent(pagePath: string, content: SharedDocContent): void {
  const doc = docs.get(pagePath);
  if (!doc) return;
  doc.body = content.body;
  doc.title = content.title;
  doc.frontmatter = content.frontmatter;
  doc.rawYaml = content.rawYaml;
}

export function setBody(pagePath: string, newBody: string, fromPaneId: string): void {
  const doc = docs.get(pagePath);
  if (!doc) return;
  doc.body = newBody;
  doc.editGen++;
  if (doc.subscribers) {
    for (const [paneId, cb] of doc.subscribers) {
      if (paneId !== fromPaneId) cb(newBody, fromPaneId);
    }
  }
  scheduleSave(pagePath, doc);
}

export function isShared(pagePath: string): boolean {
  const doc = docs.get(pagePath);
  return (doc?.panes.size ?? 0) > 1;
}

export function isDirty(pagePath: string): boolean {
  const doc = docs.get(pagePath);
  if (!doc) return false;
  return doc.editGen > doc.saveGen;
}

export function subscribe(
  pagePath: string,
  paneId: string,
  cb: (newBody: string, fromPaneId: string) => void,
): () => void {
  const doc = docs.get(pagePath);
  if (!doc) return () => {};
  if (!doc.subscribers) doc.subscribers = new Map();
  doc.subscribers.set(paneId, cb);
  return () => {
    doc.subscribers?.delete(paneId);
  };
}

export function _resetForTesting(): void {
  for (const doc of docs.values()) {
    if (doc.saveTimer) clearTimeout(doc.saveTimer);
  }
  docs.clear();
}
