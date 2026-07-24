import { describe, it, expect } from "vitest";
import { isCitationBracket } from "./citeBracket";

describe("isCitationBracket", () => {
  it("returns true for [@key2024foo]", () => {
    expect(isCitationBracket("[@key2024foo]")).toBe(true);
  });

  it("returns true for [-@a; @b]", () => {
    expect(isCitationBracket("[-@a; @b]")).toBe(true);
  });

  it("returns true for [see @a, ch. 3]", () => {
    expect(isCitationBracket("[see @a, ch. 3]")).toBe(true);
  });

  it("returns false for [sic]", () => {
    expect(isCitationBracket("[sic]")).toBe(false);
  });

  it("returns false for [3]", () => {
    expect(isCitationBracket("[3]")).toBe(false);
  });

  it("returns false for [TODO]", () => {
    expect(isCitationBracket("[TODO]")).toBe(false);
  });

  it("returns false for empty brackets []", () => {
    expect(isCitationBracket("[]")).toBe(false);
  });
});
