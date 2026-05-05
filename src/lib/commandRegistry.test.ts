import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerCommand,
  registerCommands,
  registerOnce,
  registerHandler,
  hasCommand,
  unregisterCommand,
  getAllCommands,
  getVisibleCommands,
  executeCommand,
  _clear,
  type Command,
} from "./commandRegistry";

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: "test.cmd",
    label: "Test Command",
    keywords: [],
    action: () => {},
    ...overrides,
  };
}

describe("commandRegistry", () => {
  beforeEach(() => {
    _clear();
  });

  it("registerCommand stores a command; getAllCommands returns it", () => {
    const cmd = makeCommand({ id: "core.hello" });
    registerCommand(cmd);
    expect(getAllCommands()).toEqual([cmd]);
  });

  it("registerCommands batch registers multiple commands", () => {
    const a = makeCommand({ id: "a" });
    const b = makeCommand({ id: "b" });
    registerCommands([a, b]);
    expect(getAllCommands()).toEqual([a, b]);
  });

  it("duplicate ID overwrites previous command", () => {
    const first = makeCommand({ id: "dup", label: "First" });
    const second = makeCommand({ id: "dup", label: "Second" });
    registerCommand(first);
    registerCommand(second);
    const all = getAllCommands();
    expect(all).toHaveLength(1);
    expect(all[0]!.label).toBe("Second");
  });

  it("unregisterCommand removes by ID", () => {
    registerCommand(makeCommand({ id: "a" }));
    registerCommand(makeCommand({ id: "b" }));
    unregisterCommand("a");
    expect(getAllCommands().map((c) => c.id)).toEqual(["b"]);
  });

  it("getVisibleCommands() with no query returns all commands", () => {
    const a = makeCommand({ id: "a" });
    const b = makeCommand({ id: "b" });
    registerCommands([a, b]);
    expect(getVisibleCommands()).toEqual([a, b]);
  });

  it("getVisibleCommands(query) filters by label substring (case-insensitive)", () => {
    registerCommands([
      makeCommand({ id: "a", label: "Toggle Dark Mode" }),
      makeCommand({ id: "b", label: "New Page" }),
    ]);
    expect(getVisibleCommands("dark").map((c) => c.id)).toEqual(["a"]);
    expect(getVisibleCommands("DARK").map((c) => c.id)).toEqual(["a"]);
  });

  it("getVisibleCommands(query) also matches keywords", () => {
    registerCommands([
      makeCommand({ id: "a", label: "Toggle Dark Mode", keywords: ["theme", "light"] }),
      makeCommand({ id: "b", label: "New Page", keywords: ["create"] }),
    ]);
    expect(getVisibleCommands("theme").map((c) => c.id)).toEqual(["a"]);
    expect(getVisibleCommands("create").map((c) => c.id)).toEqual(["b"]);
  });

  it("getVisibleCommands() excludes commands whose when returns false", () => {
    registerCommands([
      makeCommand({ id: "visible", when: () => true }),
      makeCommand({ id: "hidden", when: () => false }),
      makeCommand({ id: "default" }), // no when → always visible
    ]);
    expect(getVisibleCommands().map((c) => c.id)).toEqual(["visible", "default"]);
  });

  it("executeCommand(id) calls action and returns true", () => {
    const action = vi.fn();
    registerCommand(makeCommand({ id: "run-me", action }));
    expect(executeCommand("run-me")).toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });

  it("executeCommand(unknownId) returns false without throwing", () => {
    expect(executeCommand("nonexistent")).toBe(false);
  });

  it("_clear() empties the registry", () => {
    registerCommands([makeCommand({ id: "a" }), makeCommand({ id: "b" })]);
    _clear();
    expect(getAllCommands()).toEqual([]);
  });

  it("registerOnce registers commands on first call", () => {
    const cmds = [makeCommand({ id: "a" }), makeCommand({ id: "b" })];
    registerOnce("my-group", cmds);
    expect(getAllCommands()).toEqual(cmds);
  });

  it("registerOnce skips registration on subsequent calls with same group", () => {
    const first = [makeCommand({ id: "a", label: "First" })];
    const second = [makeCommand({ id: "a", label: "Second" })];
    registerOnce("my-group", first);
    registerOnce("my-group", second);
    expect(getAllCommands()).toHaveLength(1);
    expect(getAllCommands()[0]!.label).toBe("First");
  });

  it("registerOnce allows different groups independently", () => {
    registerOnce("group-a", [makeCommand({ id: "a" })]);
    registerOnce("group-b", [makeCommand({ id: "b" })]);
    expect(getAllCommands().map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("_clear() resets registerOnce groups", () => {
    registerOnce("my-group", [makeCommand({ id: "a", label: "First" })]);
    _clear();
    registerOnce("my-group", [makeCommand({ id: "a", label: "Second" })]);
    expect(getAllCommands()[0]!.label).toBe("Second");
  });

  it("registerHandler(id, fn) registers a command callable by ID", () => {
    const fn = vi.fn();
    registerHandler("test.handler", fn);
    expect(hasCommand("test.handler")).toBe(true);
    executeCommand("test.handler");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("hasCommand returns false for unregistered ID", () => {
    expect(hasCommand("nonexistent")).toBe(false);
  });

  it("executeCommand passes args through to action", () => {
    let received: unknown[] = [];
    registerHandler("args.cmd", (...args) => {
      received = args;
    });
    executeCommand("args.cmd", "a", 42);
    expect(received).toEqual(["a", 42]);
  });

  it("action returning false makes executeCommand return false", () => {
    registerHandler("returns.false", () => false);
    expect(executeCommand("returns.false")).toBe(false);
  });

  it("action returning void makes executeCommand return true", () => {
    registerHandler("returns.void", () => {});
    expect(executeCommand("returns.void")).toBe(true);
  });

  it("command without label is excluded from getVisibleCommands", () => {
    registerHandler("hidden.cmd", () => {});
    expect(getVisibleCommands().map((c) => c.id)).not.toContain("hidden.cmd");
  });

  it("command with label still appears in getVisibleCommands", () => {
    registerCommand(makeCommand({ id: "visible.cmd", label: "Visible" }));
    registerHandler("hidden.cmd", () => {});
    const ids = getVisibleCommands().map((c) => c.id);
    expect(ids).toContain("visible.cmd");
    expect(ids).not.toContain("hidden.cmd");
  });
});
