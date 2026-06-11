import { describe, it, expect } from "vitest";
import { bibKeyFromNodeId } from "./bibKey";

describe("bibKeyFromNodeId", () => {
  it('strips "bib:" prefix and returns the key', () => {
    expect(bibKeyFromNodeId("bib:smith2024")).toBe("smith2024");
  });

  it("returns empty string when prefix is present but key is empty", () => {
    expect(bibKeyFromNodeId("bib:")).toBe("");
  });

  it("returns null for a non-bib node id", () => {
    expect(bibKeyFromNodeId("notes/foo.md")).toBeNull();
  });

  it("returns null when bib: appears mid-string (anchored check)", () => {
    // Regression: the old `.replace("bib:", "")` would have returned "some-embedded"
    expect(bibKeyFromNodeId("some-bib:embedded")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(bibKeyFromNodeId("")).toBeNull();
  });
});
