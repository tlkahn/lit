import { extractHeadings, type Heading } from "./headings";

export interface HeadingNode {
  id: string;
  level: number;
  text: string;
  line: number;
  from: number;
  to: number;
  children: HeadingNode[];
}

function makeRoot(): HeadingNode {
  return { id: "root", level: 0, text: "", line: -1, from: -1, to: -1, children: [] };
}

export function buildHeadingTree(headings: Heading[]): HeadingNode {
  const root = makeRoot();
  if (headings.length === 0) return root;

  const stack: HeadingNode[] = [root];

  for (const h of headings) {
    const node: HeadingNode = {
      id: `h-${h.line}`,
      level: h.level,
      text: h.text,
      line: h.line,
      from: h.from,
      to: h.to,
      children: [],
    };

    while (stack.length > 1 && stack[stack.length - 1]!.level >= node.level) {
      stack.pop();
    }

    stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  }

  return root;
}

export function sectionRange(headings: Heading[], bodyLength: number, node: HeadingNode): { from: number; to: number } {
  const idx = headings.findIndex((h) => h.from === node.from);
  if (idx === -1) return { from: node.from, to: node.to };

  const sectionEnd = findSectionEnd(headings, idx, bodyLength);
  return { from: node.from, to: sectionEnd };
}

function findSectionEnd(headings: Heading[], idx: number, bodyLen: number): number {
  const level = headings[idx]!.level;
  for (let i = idx + 1; i < headings.length; i++) {
    if (headings[i]!.level <= level) {
      return headings[i]!.from;
    }
  }
  return bodyLen;
}

export function applyRename(body: string, node: HeadingNode, newText: string): string {
  const prefix = "#".repeat(node.level) + " ";
  const newLine = prefix + newText;
  return body.slice(0, node.from) + newLine + body.slice(node.to);
}

export function applyMove(
  body: string,
  tree: HeadingNode,
  sourceId: string,
  targetParentId: string,
  targetIndex: number,
): string {
  const source = findNode(tree, sourceId);
  if (!source) return body;
  const targetParent = findNode(tree, targetParentId);
  if (!targetParent) return body;

  const headings = extractHeadings(body);
  const srcRange = sectionRange(headings, body.length, source);
  let sectionText = body.slice(srcRange.from, srcRange.to);
  const addedNewline = !sectionText.endsWith("\n");
  if (addedNewline) sectionText += "\n";

  const sourceParent = findParent(tree, sourceId);
  if (sourceParent && targetParent.id !== sourceParent.id) {
    const expectedLevel = targetParent.level === 0 ? 1 : targetParent.level + 1;
    const delta = expectedLevel - source.level;
    if (delta !== 0) sectionText = adjustLevels(sectionText, delta);
  }

  const siblings = targetParent.children.filter((c) => c.id !== sourceId);

  let insertAt: number;
  if (siblings.length === 0 && targetParent.level === 0) {
    insertAt = body.length;
  } else if (siblings.length === 0) {
    const parentSection = sectionRange(headings, body.length, targetParent);
    insertAt = parentSection.to;
  } else if (targetIndex <= 0) {
    insertAt = siblings[0]!.from;
  } else {
    const idx = Math.min(targetIndex, siblings.length) - 1;
    const prevRange = sectionRange(headings, body.length, siblings[idx]!);
    insertAt = prevRange.to;
  }

  let result: string;
  if (srcRange.from < insertAt) {
    const removeLen = srcRange.to - srcRange.from;
    const withoutSource = body.slice(0, srcRange.from) + body.slice(srcRange.to);
    const adjusted = insertAt - removeLen;
    const sep = adjusted > 0 && withoutSource[adjusted - 1] !== "\n" ? "\n" : "";
    result = withoutSource.slice(0, adjusted) + sep + sectionText + withoutSource.slice(adjusted);
  } else if (srcRange.from > insertAt) {
    const withInsert = body.slice(0, insertAt) + sectionText + body.slice(insertAt);
    const adjustedFrom = srcRange.from + sectionText.length;
    const adjustedTo = srcRange.to + sectionText.length;
    result = withInsert.slice(0, adjustedFrom) + withInsert.slice(adjustedTo);
  } else {
    result = body.slice(0, srcRange.from) + sectionText + body.slice(srcRange.to);
  }

  if (result.endsWith("\n") && !body.endsWith("\n")) {
    result = result.slice(0, -1);
  }
  return result;
}

export function flattenTree(root: HeadingNode): HeadingNode[] {
  const result: HeadingNode[] = [];
  function walk(node: HeadingNode) {
    result.push(node);
    for (const child of node.children) walk(child);
  }
  walk(root);
  return result;
}

export function findNode(tree: HeadingNode, id: string): HeadingNode | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function findParent(tree: HeadingNode, id: string): HeadingNode | null {
  for (const child of tree.children) {
    if (child.id === id) return tree;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

const HEADING_LINE_RE = /^(#{1,6})\s/gm;

function adjustLevels(sectionText: string, delta: number): string {
  return sectionText.replace(HEADING_LINE_RE, (_match, hashes: string) => {
    const newLevel = Math.max(1, Math.min(6, hashes.length + delta));
    return "#".repeat(newLevel) + " ";
  });
}
