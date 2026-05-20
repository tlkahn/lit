import { describe, it, expect } from "vitest";
import { classifyFireType, isReplacingType, canFire } from "./fireClassification";

describe("fireClassification", () => {
  describe("classifyFireType", () => {
    it("llm is replacing", () => {
      expect(classifyFireType("llm")).toBe("replacing");
    });

    it("todo is replacing", () => {
      expect(classifyFireType("todo")).toBe("replacing");
    });

    it("translation is replacing", () => {
      expect(classifyFireType("translation")).toBe("replacing");
    });

    it("question is persisting", () => {
      expect(classifyFireType("question")).toBe("persisting");
    });

    it("note is persisting", () => {
      expect(classifyFireType("note")).toBe("persisting");
    });

    it("crossref is persisting", () => {
      expect(classifyFireType("crossref")).toBe("persisting");
    });

    it("apparatus is persisting", () => {
      expect(classifyFireType("apparatus")).toBe("persisting");
    });

    it("bare returns null", () => {
      expect(classifyFireType("bare")).toBeNull();
    });
  });

  describe("isReplacingType", () => {
    it("returns true for llm", () => {
      expect(isReplacingType("llm")).toBe(true);
    });

    it("returns false for question", () => {
      expect(isReplacingType("question")).toBe(false);
    });

    it("returns false for bare", () => {
      expect(isReplacingType("bare")).toBe(false);
    });
  });

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
  });
});
