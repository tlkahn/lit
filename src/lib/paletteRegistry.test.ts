import { describe, it, expect, beforeEach } from "vitest";
import {
  register,
  getAll,
  getByPrefix,
  _clear,
  type PaletteProvider,
} from "./paletteRegistry";

function makeProvider(overrides: Partial<PaletteProvider> = {}): PaletteProvider {
  return {
    id: "test",
    label: "Test",
    priority: 10,
    search: async () => [],
    onSelect: () => {},
    ...overrides,
  };
}

describe("paletteRegistry", () => {
  beforeEach(() => {
    _clear();
  });

  it("register adds a provider; getAll returns it", () => {
    const p = makeProvider({ id: "foo" });
    register(p);
    expect(getAll()).toEqual([p]);
  });

  it("register with same id overwrites (idempotent)", () => {
    const p1 = makeProvider({ id: "foo", label: "First" });
    const p2 = makeProvider({ id: "foo", label: "Second" });
    register(p1);
    register(p2);
    expect(getAll()).toHaveLength(1);
    expect(getAll()[0]!.label).toBe("Second");
  });

  it("getByPrefix returns matching provider", () => {
    const p = makeProvider({ id: "ann", prefix: "@" });
    register(p);
    expect(getByPrefix("@")).toBe(p);
  });

  it("getByPrefix returns undefined for unknown prefix", () => {
    register(makeProvider({ id: "ann", prefix: "@" }));
    expect(getByPrefix("#")).toBeUndefined();
  });

  it("getAll returns providers sorted by priority ascending", () => {
    register(makeProvider({ id: "c", priority: 30 }));
    register(makeProvider({ id: "a", priority: 10 }));
    register(makeProvider({ id: "b", priority: 20 }));
    const ids = getAll().map((p) => p.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("_clear removes all providers", () => {
    register(makeProvider({ id: "x" }));
    register(makeProvider({ id: "y" }));
    _clear();
    expect(getAll()).toEqual([]);
  });
});
