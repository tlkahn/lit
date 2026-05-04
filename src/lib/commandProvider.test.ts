import { describe, it, expect, beforeEach, vi } from "vitest";
import { commandProvider } from "./commandProvider";
import { _clear, registerCommand, type Command } from "./commandRegistry";

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: "test.cmd",
    label: "Test Command",
    keywords: [],
    action: () => {},
    ...overrides,
  };
}

describe("commandProvider", () => {
  beforeEach(() => {
    _clear();
  });

  it('has id="commands", prefix="!", priority=50, label="Commands"', () => {
    expect(commandProvider.id).toBe("commands");
    expect(commandProvider.prefix).toBe("!");
    expect(commandProvider.priority).toBe(50);
    expect(commandProvider.label).toBe("Commands");
  });

  it('search("") returns all visible commands as PaletteResults', async () => {
    registerCommand(makeCommand({ id: "core.hello", label: "Hello" }));
    registerCommand(makeCommand({ id: "core.world", label: "World" }));
    const results = await commandProvider.search("");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      id: "core.hello",
      title: "Hello",
      section: "Commands",
    });
    expect(results[1]).toMatchObject({
      id: "core.world",
      title: "World",
      section: "Commands",
    });
  });

  it('search("toggle") returns only matching commands', async () => {
    registerCommand(makeCommand({ id: "a", label: "Toggle Dark Mode" }));
    registerCommand(makeCommand({ id: "b", label: "New Page" }));
    const results = await commandProvider.search("toggle");
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("a");
  });

  it("results include shortcut and icon from Command", async () => {
    registerCommand(
      makeCommand({ id: "x", label: "X", shortcut: "Mod-Shift-X", icon: "🎨" }),
    );
    const results = await commandProvider.search("");
    expect(results[0]).toMatchObject({
      shortcut: "Mod-Shift-X",
      icon: "🎨",
    });
  });

  it("onSelect(result) calls executeCommand(result.id)", () => {
    const action = vi.fn();
    registerCommand(makeCommand({ id: "core.run", action }));
    commandProvider.onSelect({
      id: "core.run",
      title: "Run",
      section: "Commands",
    });
    expect(action).toHaveBeenCalledOnce();
  });

  it("commands with when: () => false are excluded from search results", async () => {
    registerCommand(makeCommand({ id: "visible", label: "Visible", when: () => true }));
    registerCommand(makeCommand({ id: "hidden", label: "Hidden", when: () => false }));
    registerCommand(makeCommand({ id: "default", label: "Default" }));
    const results = await commandProvider.search("");
    const ids = results.map((r) => r.id);
    expect(ids).toContain("visible");
    expect(ids).toContain("default");
    expect(ids).not.toContain("hidden");
  });
});
