import { describe, it, expect } from "vitest";
import { classifyFireType, isReplacingType, canFire } from "./fireClassification";

describe("fireClassification", () => {
  describe("classifyFireType", () => {
    it("llm is replacing", () => {
      expect(classifyFireType("llm")).toBe("replacing");
    });

    it("todo returns null (not fire-eligible)", () => {
      expect(classifyFireType("todo")).toBeNull();
    });

    it("translation is replacing", () => {
      expect(classifyFireType("translation")).toBe("replacing");
    });

    it("question is replacing", () => {
      expect(classifyFireType("question")).toBe("replacing");
    });

    it("note returns null (not fire-eligible)", () => {
      expect(classifyFireType("note")).toBeNull();
    });

    it("crossref returns null (not fire-eligible)", () => {
      expect(classifyFireType("crossref")).toBeNull();
    });

    it("apparatus returns null (not fire-eligible)", () => {
      expect(classifyFireType("apparatus")).toBeNull();
    });

    it("bare returns null", () => {
      expect(classifyFireType("bare")).toBeNull();
    });
  });

  describe("isReplacingType", () => {
    it("returns true for llm", () => {
      expect(isReplacingType("llm")).toBe(true);
    });

    it("returns true for question", () => {
      expect(isReplacingType("question")).toBe(true);
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
  });
});
