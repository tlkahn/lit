import { describe, it, expect } from "vitest";
import { findSentenceAt } from "./sentenceBoundary";

describe("findSentenceAt", () => {
  it("returns full range for a single sentence", () => {
    const text = "Hello world.";
    expect(findSentenceAt(text, 3)).toEqual({ from: 0, to: 12 });
  });

  it("returns correct sentence based on cursor position", () => {
    const text = "First sentence. Second sentence.";
    expect(findSentenceAt(text, 3)).toEqual({ from: 0, to: 15 });
    expect(findSentenceAt(text, 20)).toEqual({ from: 16, to: 32 });
  });

  it("cursor at sentence boundary selects the next sentence", () => {
    const text = "First sentence. Second sentence.";
    expect(findSentenceAt(text, 16)).toEqual({ from: 16, to: 32 });
  });

  it("handles multi-line paragraph", () => {
    const text = "This is a sentence\nthat spans two lines. And another.";
    expect(findSentenceAt(text, 5)).toEqual({ from: 0, to: 40 });
    expect(findSentenceAt(text, 45)).toEqual({ from: 41, to: 53 });
  });

  it("returns paragraph range when no sentence-ending punctuation", () => {
    const text = "No punctuation here";
    expect(findSentenceAt(text, 5)).toEqual({ from: 0, to: 19 });
  });

  it("handles empty document", () => {
    expect(findSentenceAt("", 0)).toEqual({ from: 0, to: 0 });
  });

  it("treats heading as its own sentence", () => {
    const text = "# My Heading\n\nSome text here. More text.";
    expect(findSentenceAt(text, 5)).toEqual({ from: 0, to: 12 });
    expect(findSentenceAt(text, 20)).toEqual({ from: 14, to: 29 });
  });

  it("treats list items as their own sentence context", () => {
    const text = "- First item. More of first.\n- Second item.";
    expect(findSentenceAt(text, 3)).toEqual({ from: 2, to: 13 });
    expect(findSentenceAt(text, 35)).toEqual({ from: 31, to: 43 });
  });

  it("does not split on ellipsis", () => {
    const text = "Wait... something happened.";
    expect(findSentenceAt(text, 3)).toEqual({ from: 0, to: 27 });
  });

  it("does not split on common abbreviations", () => {
    const text = "Mr. Smith went home. Then left.";
    expect(findSentenceAt(text, 3)).toEqual({ from: 0, to: 20 });
  });

  it("handles multiple paragraphs", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    expect(findSentenceAt(text, 5)).toEqual({ from: 0, to: 16 });
    expect(findSentenceAt(text, 25)).toEqual({ from: 18, to: 35 });
  });

  it("handles question marks and exclamation marks", () => {
    const text = "Is this a question? Yes it is!";
    expect(findSentenceAt(text, 5)).toEqual({ from: 0, to: 19 });
    expect(findSentenceAt(text, 25)).toEqual({ from: 20, to: 30 });
  });

  it("handles cursor at end of document", () => {
    const text = "A sentence.";
    expect(findSentenceAt(text, 11)).toEqual({ from: 0, to: 11 });
  });

  it("clamps out-of-range position", () => {
    const text = "Hello.";
    expect(findSentenceAt(text, 100)).toEqual({ from: 0, to: 6 });
  });

  it("handles code fence as single block", () => {
    const text = "Before.\n\n```\ncode here.\nmore code.\n```\n\nAfter.";
    expect(findSentenceAt(text, 15)).toEqual({ from: 9, to: 38 });
  });
});
