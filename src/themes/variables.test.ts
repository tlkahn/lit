import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("monospace size ratio (#1059)", () => {
  const css = readFileSync(resolve(__dirname, "variables.css"), "utf-8");

  it("defines --font-monospace-size-ratio: 0.875 in .theme-light", () => {
    const lightBlock = css.split(".theme-dark")[0]!;
    expect(lightBlock).toContain("--font-monospace-size-ratio: 0.875");
  });

  it("defines --font-monospace-size-ratio: 0.875 in .theme-dark", () => {
    const darkBlock = css.split(".theme-dark")[1]!;
    expect(darkBlock).toContain("--font-monospace-size-ratio: 0.875");
  });

  it("sits in the /* Fonts */ section next to --font-monospace-theme in .theme-light", () => {
    const lightBlock = css.split(".theme-dark")[0]!;
    const fontsSection = lightBlock.split("/* Fonts */")[1]!;
    expect(fontsSection).toBeDefined();
    const familyIndex = fontsSection.indexOf("--font-monospace-theme");
    const ratioIndex = fontsSection.indexOf("--font-monospace-size-ratio");
    expect(familyIndex).toBeGreaterThanOrEqual(0);
    expect(ratioIndex).toBeGreaterThanOrEqual(0);
    const linesApart =
      fontsSection
        .slice(Math.min(familyIndex, ratioIndex), Math.max(familyIndex, ratioIndex))
        .split("\n").length - 1;
    expect(linesApart).toBeLessThan(6);
  });

  it("sits in the /* Fonts */ section next to --font-monospace-theme in .theme-dark", () => {
    const darkBlock = css.split(".theme-dark")[1]!;
    const fontsSection = darkBlock.split("/* Fonts */")[1]!;
    expect(fontsSection).toBeDefined();
    const familyIndex = fontsSection.indexOf("--font-monospace-theme");
    const ratioIndex = fontsSection.indexOf("--font-monospace-size-ratio");
    expect(familyIndex).toBeGreaterThanOrEqual(0);
    expect(ratioIndex).toBeGreaterThanOrEqual(0);
    const linesApart =
      fontsSection
        .slice(Math.min(familyIndex, ratioIndex), Math.max(familyIndex, ratioIndex))
        .split("\n").length - 1;
    expect(linesApart).toBeLessThan(6);
  });
});
