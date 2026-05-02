import { describe, it, expect, beforeEach } from "vitest";
import { paletteRegistry, type PaletteProvider } from "./paletteRegistry";

function makeProvider(overrides: Partial<PaletteProvider> & { id: string }): PaletteProvider {
  return {
    label: overrides.id,
    priority: 0,
    search: async () => [],
    onSelect: () => {},
    ...overrides,
  };
}

describe("paletteRegistry", () => {
  beforeEach(() => {
    paletteRegistry._clear();
  });

  it("register adds a provider, getAll returns it", () => {
    const p = makeProvider({ id: "test" });
    paletteRegistry.register(p);
    expect(paletteRegistry.getAll()).toEqual([p]);
  });

  it("register overwrites provider with same id (idempotent)", () => {
    const p1 = makeProvider({ id: "test", label: "v1" });
    const p2 = makeProvider({ id: "test", label: "v2" });
    paletteRegistry.register(p1);
    paletteRegistry.register(p2);
    const all = paletteRegistry.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.label).toBe("v2");
  });

  it("getByPrefix returns matching provider", () => {
    const p = makeProvider({ id: "ann", prefix: "@" });
    paletteRegistry.register(p);
    expect(paletteRegistry.getByPrefix("@")).toBe(p);
  });

  it("getByPrefix returns undefined for unknown prefix", () => {
    expect(paletteRegistry.getByPrefix("@")).toBeUndefined();
  });

  it("getAll returns providers sorted by priority ascending", () => {
    paletteRegistry.register(makeProvider({ id: "c", priority: 30 }));
    paletteRegistry.register(makeProvider({ id: "a", priority: 10 }));
    paletteRegistry.register(makeProvider({ id: "b", priority: 20 }));
    const ids = paletteRegistry.getAll().map((p) => p.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("_clear removes all providers", () => {
    paletteRegistry.register(makeProvider({ id: "test" }));
    paletteRegistry._clear();
    expect(paletteRegistry.getAll()).toEqual([]);
  });
});
