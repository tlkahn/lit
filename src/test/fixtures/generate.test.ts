import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { Annotation as AnnotationGrammar } from "../../editor/markdown/annotation";
import { Comment as CommentGrammar } from "../../editor/markdown/comment";
import { generateBlockAnnotationStress } from "./generate";

function countNodes(doc: string, nodeName: string): number {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [CommentGrammar, AnnotationGrammar] })],
  });
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  if (!tree) throw new Error("parse did not complete in 5000ms");
  let count = 0;
  tree.iterate({
    enter: (node) => {
      if (node.name === nodeName) count++;
    },
  });
  return count;
}

describe("generateBlockAnnotationStress", () => {
  it("generates >= 1_300_000 bytes by default", { timeout: 10_000 }, () => {
    const doc = generateBlockAnnotationStress();
    expect(doc.length).toBeGreaterThanOrEqual(1_300_000);
  });

  it("respects custom targetBytes", { timeout: 10_000 }, () => {
    const doc = generateBlockAnnotationStress({ targetBytes: 500_000 });
    expect(doc.length).toBeGreaterThanOrEqual(500_000);
  });

  it("emits exactly 150 BlockAnnotation nodes by default", { timeout: 15_000 }, () => {
    const doc = generateBlockAnnotationStress();
    expect(countNodes(doc, "BlockAnnotation")).toBe(150);
  });

  it("respects custom annotationCount", { timeout: 15_000 }, () => {
    const doc = generateBlockAnnotationStress({ annotationCount: 50, targetBytes: 200_000 });
    expect(countNodes(doc, "BlockAnnotation")).toBe(50);
  });

  it("every BlockAnnotation is multiline and starts at line beginning", { timeout: 15_000 }, () => {
    const doc = generateBlockAnnotationStress();
    const state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: [CommentGrammar, AnnotationGrammar] })],
    });
    const tree = ensureSyntaxTree(state, state.doc.length, 5000);
    if (!tree) throw new Error("parse did not complete in 5000ms");
    let count = 0;
    tree.iterate({
      enter: (node) => {
        if (node.name !== "BlockAnnotation") return;
        count++;
        const fromLine = state.doc.lineAt(node.from);
        const toLine = state.doc.lineAt(node.to);
        expect(fromLine.number, `block ${count}: not multiline`).not.toBe(toLine.number);
        expect(fromLine.from, `block ${count}: not at line start`).toBe(node.from);
      },
    });
    expect(count).toBeGreaterThan(0);
  });

  it("contains both head kinds (note and thread)", () => {
    const doc = generateBlockAnnotationStress();
    const threadMatches = doc.match(/<!---\nth\n/g) ?? [];
    expect(threadMatches.length).toBeGreaterThanOrEqual(40);
    expect(threadMatches.length).toBeLessThan(150);
  });

  it("emits zero InlineAnnotation nodes", { timeout: 15_000 }, () => {
    const doc = generateBlockAnnotationStress();
    expect(countNodes(doc, "InlineAnnotation")).toBe(0);
  });

  it("is deterministic: same seed produces byte-identical output", () => {
    const a = generateBlockAnnotationStress({ annotationCount: 20, targetBytes: 50_000, seed: 42 });
    const b = generateBlockAnnotationStress({ annotationCount: 20, targetBytes: 50_000, seed: 42 });
    expect(a).toBe(b);
  });

  it("different seed produces different output", () => {
    const a = generateBlockAnnotationStress({ annotationCount: 20, targetBytes: 50_000, seed: 42 });
    const b = generateBlockAnnotationStress({ annotationCount: 20, targetBytes: 50_000, seed: 99 });
    expect(a).not.toBe(b);
  });
});
