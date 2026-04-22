import { describe, it, expect, beforeEach } from "vitest";
import { commandRegistry } from "./commands";

describe("commandRegistry", () => {
  beforeEach(() => {
    commandRegistry._clear();
  });

  it("register and retrieve a command by ID", () => {
    commandRegistry.register("test.cmd", () => true);
    expect(commandRegistry.has("test.cmd")).toBe(true);
  });

  it("execute returns true on known command", () => {
    commandRegistry.register("test.cmd", () => true);
    expect(commandRegistry.execute("test.cmd")).toBe(true);
  });

  it("execute returns false on unknown command", () => {
    expect(commandRegistry.execute("nonexistent")).toBe(false);
  });

  it("list returns all registered command IDs", () => {
    commandRegistry.register("a", () => {});
    commandRegistry.register("b", () => {});
    expect(commandRegistry.list()).toEqual(["a", "b"]);
  });

  it("registering duplicate ID overwrites previous handler", () => {
    let called = "";
    commandRegistry.register("dup", () => { called = "first"; });
    commandRegistry.register("dup", () => { called = "second"; });
    commandRegistry.execute("dup");
    expect(called).toBe("second");
  });

  it("execute passes arguments to handler", () => {
    let received: unknown[] = [];
    commandRegistry.register("args.cmd", (...args) => { received = args; });
    commandRegistry.execute("args.cmd", "a", 42);
    expect(received).toEqual(["a", 42]);
  });
});
