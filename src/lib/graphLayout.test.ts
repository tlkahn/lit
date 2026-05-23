import { describe, it, expect, afterEach } from "vitest";
import { computeNodeSize, resolveThemeColors, MIN_SIZE, MAX_SIZE } from "./graphLayout";

describe("graphLayout", () => {
  describe("computeNodeSize", () => {
    it("zero pagerank returns MIN_SIZE", () => {
      expect(computeNodeSize(0, 0.5)).toBe(MIN_SIZE);
    });

    it("max pagerank returns MAX_SIZE", () => {
      expect(computeNodeSize(0.5, 0.5)).toBeCloseTo(MAX_SIZE, 1);
    });

    it("result is between MIN_SIZE and MAX_SIZE", () => {
      const size = computeNodeSize(0.3, 1.0);
      expect(size).toBeGreaterThanOrEqual(MIN_SIZE);
      expect(size).toBeLessThanOrEqual(MAX_SIZE);
    });
  });

  describe("resolveThemeColors", () => {
    afterEach(() => {
      document.documentElement.style.removeProperty("--interactive-accent");
      document.documentElement.style.removeProperty("--text-faint");
      document.documentElement.style.removeProperty("--background-modifier-border");
      document.documentElement.style.removeProperty("--text-normal");
    });

    it("reads --interactive-accent and --text-faint from computed style", () => {
      document.documentElement.style.setProperty("--interactive-accent", "#0969da");
      document.documentElement.style.setProperty("--text-faint", "#818b98");
      const colors = resolveThemeColors();
      expect(colors.accentColor).toBe("#0969da");
      expect(colors.stubColor).toBe("#818b98");
    });

    it("falls back to defaults when CSS vars are unset", () => {
      const colors = resolveThemeColors();
      expect(colors.accentColor).toBe("#0969da");
      expect(colors.stubColor).toBe("#818b98");
    });

    it("resolves dimColor from --background-modifier-border", () => {
      document.documentElement.style.setProperty("--background-modifier-border", "#3d444d");
      const colors = resolveThemeColors();
      expect(colors.dimColor).toBe("#3d444d");
    });

    it("dimColor falls back to default when CSS var is unset", () => {
      const colors = resolveThemeColors();
      expect(colors.dimColor).toBe("#d1d9e0");
    });

    it("resolves edgeColor from --text-faint", () => {
      document.documentElement.style.setProperty("--text-faint", "#656c76");
      const colors = resolveThemeColors();
      expect(colors.edgeColor).toBe("#656c76");
    });

    it("resolves labelColor from --text-normal", () => {
      document.documentElement.style.setProperty("--text-normal", "#f0f6fc");
      const colors = resolveThemeColors();
      expect(colors.labelColor).toBe("#f0f6fc");
    });

    it("edgeColor and labelColor fall back to defaults when CSS vars are unset", () => {
      const colors = resolveThemeColors();
      expect(colors.edgeColor).toBe("#818b98");
      expect(colors.labelColor).toBe("#1f2328");
    });
  });
});
