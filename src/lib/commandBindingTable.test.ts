import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mockInvoke, resetInvokeMock } from "../test/tauri-mock";
import { registerCommand, _clear } from "./commandRegistry";
import type { Command } from "./commandRegistry";
import type { KeyBinding } from "./ipc";
import {
  buildCommandBindingTable,
  fetchCommandBindingTable,
} from "./commandBindingTable";

function makeCommand(id: string, label?: string): Command {
  return { id, label: label ?? id, action: () => {} };
}

function makeBinding(
  command: string,
  key: string,
  opts?: Partial<KeyBinding>,
): KeyBinding {
  return { command, key, ...opts };
}

describe("buildCommandBindingTable", () => {
  it("returns empty array for empty inputs", () => {
    const result = buildCommandBindingTable([], []);
    expect(result).toEqual([]);
  });

  it("marks a command with no bindings as unbound", () => {
    const cmd = makeCommand("editor.save");
    const result = buildCommandBindingTable([cmd], []);
    expect(result).toEqual([
      {
        commandId: "editor.save",
        command: cmd,
        bindings: [],
        status: "unbound",
      },
    ]);
  });

  it("marks a command with a matching binding as bound", () => {
    const cmd = makeCommand("editor.save");
    const binding = makeBinding("editor.save", "Cmd+S");
    const result = buildCommandBindingTable([cmd], [binding]);
    expect(result).toEqual([
      {
        commandId: "editor.save",
        command: cmd,
        bindings: [binding],
        status: "bound",
      },
    ]);
  });

  it("collects multiple bindings for the same command", () => {
    const cmd = makeCommand("editor.save");
    const b1 = makeBinding("editor.save", "Cmd+S");
    const b2 = makeBinding("editor.save", "Ctrl+S");
    const result = buildCommandBindingTable([cmd], [b1, b2]);
    expect(result).toHaveLength(1);
    expect(result[0]!.bindings).toEqual([b1, b2]);
    expect(result[0]!.status).toBe("bound");
  });

  it("marks a binding with no matching command as unknown-command", () => {
    const binding = makeBinding("ghost.command", "Cmd+G");
    const result = buildCommandBindingTable([], [binding]);
    expect(result).toEqual([
      {
        commandId: "ghost.command",
        command: null,
        bindings: [binding],
        status: "unknown-command",
      },
    ]);
  });

  it("handles mixed bound, unbound, and orphaned entries", () => {
    const cmd1 = makeCommand("editor.save");
    const cmd2 = makeCommand("editor.close");
    const b1 = makeBinding("editor.save", "Cmd+S");
    const orphan = makeBinding("removed.command", "Cmd+X");

    const result = buildCommandBindingTable([cmd1, cmd2], [b1, orphan]);

    const bound = result.filter((e) => e.status === "bound");
    const unbound = result.filter((e) => e.status === "unbound");
    const unknown = result.filter((e) => e.status === "unknown-command");

    expect(bound).toHaveLength(1);
    expect(bound[0]!.commandId).toBe("editor.save");
    expect(unbound).toHaveLength(1);
    expect(unbound[0]!.commandId).toBe("editor.close");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.commandId).toBe("removed.command");
  });

  it("includes bindings with different when contexts for the same command", () => {
    const cmd = makeCommand("editor.indent");
    const b1 = makeBinding("editor.indent", "Tab", { when: "editorFocus" });
    const b2 = makeBinding("editor.indent", "Tab", { when: "listFocus" });
    const result = buildCommandBindingTable([cmd], [b1, b2]);
    expect(result[0]!.bindings).toEqual([b1, b2]);
  });

  it("groups multiple orphaned bindings for the same unknown command", () => {
    const b1 = makeBinding("ghost.command", "Cmd+G");
    const b2 = makeBinding("ghost.command", "Ctrl+G");
    const result = buildCommandBindingTable([], [b1, b2]);
    expect(result).toHaveLength(1);
    expect(result[0]!.bindings).toEqual([b1, b2]);
    expect(result[0]!.status).toBe("unknown-command");
  });

  it("deduplicates commands with same id (last wins on value and position)", () => {
    const cmdA = makeCommand("aaa", "A");
    const cmdB1 = makeCommand("bbb", "B v1");
    const cmdB2 = makeCommand("bbb", "B v2");
    const result = buildCommandBindingTable([cmdB1, cmdA, cmdB2], []);
    expect(result).toHaveLength(2);
    expect(result[0]!.commandId).toBe("aaa");
    expect(result[1]!.commandId).toBe("bbb");
    expect(result[1]!.command!.label).toBe("B v2");
  });

  it("preserves source metadata on bindings", () => {
    const cmd = makeCommand("editor.save");
    const binding = makeBinding("editor.save", "Cmd+S", { source: "user" });
    const result = buildCommandBindingTable([cmd], [binding]);
    expect(result[0]!.bindings[0]!.source).toBe("user");
  });

  it("outputs registered commands in insertion order, then orphans in first-seen order", () => {
    const cmds = [makeCommand("aaa"), makeCommand("bbb"), makeCommand("ccc")];
    const bindings = [
      makeBinding("zzz.orphan", "Z"),
      makeBinding("aaa", "A"),
      makeBinding("yyy.orphan", "Y"),
    ];
    const result = buildCommandBindingTable(cmds, bindings);
    const ids = result.map((e) => e.commandId);
    expect(ids).toEqual(["aaa", "bbb", "ccc", "zzz.orphan", "yyy.orphan"]);
  });
});

describe("fetchCommandBindingTable", () => {
  beforeEach(() => {
    _clear();
  });

  afterEach(() => {
    _clear();
    resetInvokeMock();
  });

  it("deduplicates bindings that appear in both keymaps and menu shortcuts", async () => {
    registerCommand(makeCommand("editor.save"));

    mockInvoke((cmd) => {
      if (cmd === "get_keymaps")
        return [{ command: "editor.save", key: "Cmd+S", source: "default" }];
      if (cmd === "get_menu_shortcuts")
        return [{ command: "editor.save", key: "Cmd+S", source: "menu" }];
      return [];
    });

    const result = await fetchCommandBindingTable();
    const save = result.find((e) => e.commandId === "editor.save")!;
    expect(save.bindings).toHaveLength(1);
    expect(save.bindings[0]!.source).toBe("menu");
  });

  it("joins IPC keymaps + menu shortcuts with registered commands", async () => {
    registerCommand(makeCommand("editor.save"));
    registerCommand(makeCommand("editor.close"));

    mockInvoke((cmd) => {
      if (cmd === "get_keymaps")
        return [{ command: "editor.save", key: "Cmd+S", source: "default" }];
      if (cmd === "get_menu_shortcuts")
        return [{ command: "editor.close", key: "Cmd+W", source: "menu" }];
      return [];
    });

    const result = await fetchCommandBindingTable();

    const save = result.find((e) => e.commandId === "editor.save")!;
    expect(save.status).toBe("bound");
    expect(save.bindings[0]!.key).toBe("Cmd+S");

    const close = result.find((e) => e.commandId === "editor.close")!;
    expect(close.status).toBe("bound");
    expect(close.bindings[0]!.source).toBe("menu");
  });
});
