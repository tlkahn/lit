import { describe, it, expect } from "vitest";
import { canFire } from "./fireClassification";

describe("fireClassification", () => {
  describe("canFire", () => {
    it("returns true for llm", () => {
      expect(canFire("llm")).toBe(true);
    });

    it("returns true for question", () => {
      expect(canFire("question")).toBe(true);
    });

    it("returns false for bare", () => {
      expect(canFire("bare")).toBe(false);
    });

    it("returns false for todo", () => {
      expect(canFire("todo")).toBe(false);
    });

    it("returns false for note", () => {
      expect(canFire("note")).toBe(false);
    });

    it("returns false for crossref", () => {
      expect(canFire("crossref")).toBe(false);
    });

    it("returns false for apparatus", () => {
      expect(canFire("apparatus")).toBe(false);
    });

    it("returns false for thread", () => {
      expect(canFire("thread")).toBe(false);
    });
  });
});
