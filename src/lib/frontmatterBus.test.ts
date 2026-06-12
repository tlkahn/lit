import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  onFrontmatterPatch,
  emitFrontmatterPatch,
  _resetForTesting,
} from "./frontmatterBus";

describe("frontmatterBus", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("emitFrontmatterPatch calls registered handler", () => {
    const handler = vi.fn();
    onFrontmatterPatch("note.md", handler);

    emitFrontmatterPatch("note.md", { bibliography: "refs.bib" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith("note.md", { bibliography: "refs.bib" });
  });

  it("emitFrontmatterPatch is no-op with no handler", () => {
    // Should not throw
    expect(() => {
      emitFrontmatterPatch("note.md", { bibliography: "refs.bib" });
    }).not.toThrow();
  });

  it("unsubscribe prevents further calls", () => {
    const handler = vi.fn();
    const unsub = onFrontmatterPatch("note.md", handler);

    unsub();
    emitFrontmatterPatch("note.md", { bibliography: "refs.bib" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("_resetForTesting clears all handlers", () => {
    const handler = vi.fn();
    onFrontmatterPatch("note.md", handler);

    _resetForTesting();
    emitFrontmatterPatch("note.md", { bibliography: "refs.bib" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("only calls handler for matching pagePath", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    onFrontmatterPatch("note1.md", handler1);
    onFrontmatterPatch("note2.md", handler2);

    emitFrontmatterPatch("note1.md", { bibliography: "refs.bib" });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).not.toHaveBeenCalled();
  });
});
