import { describe, it, expect, beforeEach } from "vitest";
import { useCardboxStore } from "./cardbox";
import { useCardboxUndoStore } from "./cardboxUndo";
import { mockInvoke } from "../test/tauri-mock";

describe("cardbox undo integration", () => {
  beforeEach(() => {
    useCardboxStore.setState({
      annotations: [],
      expandedUuid: null,
      loading: false,
      searchQuery: "",
      activeTypes: null,
      activeColors: null,
      order: [],
      links: [],
      groups: {},
      pinned: [],
      notes: {},
      colors: {},
      connectionsForUuid: null,
      connectionsSavedFilters: null,
    });
    useCardboxUndoStore.setState({
      undoStack: [],
      redoStack: [],
      replayDepth: 0,
    });
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return [];
      if (cmd === "read_cardbox_layout")
        return { version: 3, order: [], links: [], groups: {} };
      if (cmd === "write_cardbox_layout") return null;
      if (cmd === "add_cardbox_link") return null;
      if (cmd === "remove_cardbox_link") return null;
      if (cmd === "create_cardbox_group") return null;
      if (cmd === "rename_cardbox_group") return null;
      if (cmd === "dissolve_cardbox_group") return null;
      if (cmd === "move_card_to_group") return null;
      if (cmd === "remove_card_from_group") return null;
      if (cmd === "toggle_group_collapsed") return null;
      if (cmd === "pin_cardbox_card") return null;
      if (cmd === "unpin_cardbox_card") return null;
      if (cmd === "set_card_note") return null;
      if (cmd === "clear_card_note") return null;
      if (cmd === "set_card_color") return null;
      if (cmd === "clear_card_color") return null;
      if (cmd === "batch_set_card_color") return null;
      if (cmd === "batch_clear_card_color") return null;
      if (cmd === "batch_pin_cards") return null;
      if (cmd === "batch_unpin_cards") return null;
      return null;
    });
  });

  describe("addLink / removeLink", () => {
    it("addLink then undo removes the link, redo re-adds it", async () => {
      await useCardboxStore.getState().addLink("u1", "u2");
      expect(useCardboxStore.getState().links).toEqual([["u1", "u2"]]);
      expect(useCardboxUndoStore.getState().undoStack).toHaveLength(1);

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().links).toEqual([]);

      await useCardboxUndoStore.getState().redo();
      expect(useCardboxStore.getState().links).toEqual([["u1", "u2"]]);
    });

    it("removeLink then undo re-adds the link", async () => {
      useCardboxStore.setState({ links: [["u1", "u2"]] });
      await useCardboxStore.getState().removeLink("u1", "u2");
      expect(useCardboxStore.getState().links).toEqual([]);

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().links).toEqual([["u1", "u2"]]);
    });
  });

  describe("pinCard / unpinCard", () => {
    it("pinCard then undo unpins, redo re-pins", async () => {
      await useCardboxStore.getState().pinCard("u1");
      expect(useCardboxStore.getState().pinned).toEqual(["u1"]);

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().pinned).toEqual([]);

      await useCardboxUndoStore.getState().redo();
      expect(useCardboxStore.getState().pinned).toEqual(["u1"]);
    });

    it("unpinCard then undo re-pins", async () => {
      useCardboxStore.setState({ pinned: ["u1"] });
      await useCardboxStore.getState().unpinCard("u1");
      expect(useCardboxStore.getState().pinned).toEqual([]);

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().pinned).toEqual(["u1"]);
    });
  });

  describe("setCardColor / clearCardColor", () => {
    it("setCardColor then undo restores previous color", async () => {
      useCardboxStore.setState({ colors: { u1: "blue" } });
      await useCardboxStore.getState().setCardColor("u1", "green");
      expect(useCardboxStore.getState().colors.u1).toBe("green");

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().colors.u1).toBe("blue");
    });

    it("setCardColor on uncolored card, undo clears the color", async () => {
      await useCardboxStore.getState().setCardColor("u1", "green");
      expect(useCardboxStore.getState().colors.u1).toBe("green");

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().colors.u1).toBeUndefined();
    });

    it("clearCardColor then undo restores the color", async () => {
      useCardboxStore.setState({ colors: { u1: "blue" } });
      await useCardboxStore.getState().clearCardColor("u1");
      expect(useCardboxStore.getState().colors.u1).toBeUndefined();

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().colors.u1).toBe("blue");
    });
  });

  describe("createGroup / dissolveGroup", () => {
    it("createGroup then undo dissolves the group", async () => {
      useCardboxStore.setState({ order: ["u1", "u2", "u3"], groups: {} });
      await useCardboxStore.getState().createGroup("g1", "My Group", ["u1", "u3"]);
      expect(useCardboxStore.getState().groups.g1).toBeDefined();
      expect(useCardboxStore.getState().groups.g1!.order).toEqual(["u1", "u3"]);

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().groups.g1).toBeUndefined();
      expect(useCardboxStore.getState().order).toContain("u1");
      expect(useCardboxStore.getState().order).toContain("u3");
    });

    it("dissolveGroup then undo re-creates the group with same members", async () => {
      useCardboxStore.setState({
        order: ["u3", "group:g1", "u4"],
        groups: { g1: { name: "G", order: ["u1", "u2"], collapsed: false } },
      });
      await useCardboxStore.getState().dissolveGroup("g1");
      expect(useCardboxStore.getState().groups.g1).toBeUndefined();

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().groups.g1).toBeDefined();
      expect(useCardboxStore.getState().groups.g1!.order).toEqual(["u1", "u2"]);
      expect(useCardboxStore.getState().groups.g1!.name).toBe("G");
    });
  });

  describe("renameGroup", () => {
    it("renameGroup then undo restores original name", async () => {
      useCardboxStore.setState({
        order: ["group:g1"],
        groups: { g1: { name: "Old", order: ["u1"], collapsed: false } },
      });
      await useCardboxStore.getState().renameGroup("g1", "New Name");
      expect(useCardboxStore.getState().groups.g1!.name).toBe("New Name");

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().groups.g1!.name).toBe("Old");
    });
  });

  describe("setNote / clearNote", () => {
    it("setNote then undo restores previous note body", async () => {
      useCardboxStore.setState({ notes: { u1: { body: "original", updated_at: "2024-01-01" } } });
      await useCardboxStore.getState().setNote("u1", "updated");
      expect(useCardboxStore.getState().notes.u1?.body).toBe("updated");

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().notes.u1?.body).toBe("original");
    });

    it("setNote on card without note, undo clears the note", async () => {
      await useCardboxStore.getState().setNote("u1", "new note");
      expect(useCardboxStore.getState().notes.u1?.body).toBe("new note");

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().notes.u1).toBeUndefined();
    });

    it("clearNote then undo restores the note", async () => {
      useCardboxStore.setState({ notes: { u1: { body: "my note", updated_at: "2024-01-01" } } });
      await useCardboxStore.getState().clearNote("u1");
      expect(useCardboxStore.getState().notes.u1).toBeUndefined();

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().notes.u1?.body).toBe("my note");
    });
  });

  describe("batch operations", () => {
    it("batchSetColor then undo restores each card's previous color", async () => {
      useCardboxStore.setState({ colors: { u1: "blue" } });
      await useCardboxStore.getState().batchSetColor(["u1", "u2"], "green");
      expect(useCardboxStore.getState().colors).toEqual({ u1: "green", u2: "green" });

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().colors.u1).toBe("blue");
      expect(useCardboxStore.getState().colors.u2).toBeUndefined();
    });

    it("batchClearColor then undo restores each card's color", async () => {
      useCardboxStore.setState({ colors: { u1: "blue", u2: "green", u3: "pink" } });
      await useCardboxStore.getState().batchClearColor(["u1", "u2"]);
      expect(useCardboxStore.getState().colors.u1).toBeUndefined();
      expect(useCardboxStore.getState().colors.u2).toBeUndefined();

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().colors.u1).toBe("blue");
      expect(useCardboxStore.getState().colors.u2).toBe("green");
    });

    it("batchPin then undo unpins the cards", async () => {
      await useCardboxStore.getState().batchPin(["u1", "u2"]);
      expect(useCardboxStore.getState().pinned).toEqual(["u1", "u2"]);

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().pinned).toEqual([]);
    });

    it("batchUnpin then undo re-pins the cards", async () => {
      useCardboxStore.setState({ pinned: ["u1", "u2", "u3"] });
      await useCardboxStore.getState().batchUnpin(["u1", "u2"]);
      expect(useCardboxStore.getState().pinned).toEqual(["u3"]);

      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().pinned).toContain("u1");
      expect(useCardboxStore.getState().pinned).toContain("u2");
    });

    it("batchLink then undo removes the new links", async () => {
      useCardboxStore.setState({ links: [["u1", "u2"]] });
      await useCardboxStore.getState().batchLink(["u1", "u2", "u3"]);
      // Should have u1:u2 (existing) + u1:u3 + u2:u3 (new)
      expect(useCardboxStore.getState().links).toHaveLength(3);

      await useCardboxUndoStore.getState().undo();
      // Should only have the original link
      expect(useCardboxStore.getState().links).toHaveLength(1);
      expect(useCardboxStore.getState().links[0]).toEqual(["u1", "u2"]);
    });
  });

  describe("replayDepth guard", () => {
    it("no undo entry pushed when replayDepth > 0", async () => {
      // Do an action that pushes undo
      await useCardboxStore.getState().pinCard("u1");
      expect(useCardboxUndoStore.getState().undoStack).toHaveLength(1);

      // Undo should trigger unpinCard, which should NOT push another undo entry
      await useCardboxUndoStore.getState().undo();
      // The undo stack should be empty (entry moved to redo), no new entry pushed
      expect(useCardboxUndoStore.getState().undoStack).toHaveLength(0);
      expect(useCardboxUndoStore.getState().redoStack).toHaveLength(1);
    });
  });

  describe("note coalescing", () => {
    it("multiple setNote calls on same card coalesce into one undo entry", async () => {
      await useCardboxStore.getState().setNote("u1", "a");
      await useCardboxStore.getState().setNote("u1", "ab");
      await useCardboxStore.getState().setNote("u1", "abc");
      // Should only have 1 undo entry due to coalescing
      expect(useCardboxUndoStore.getState().undoStack).toHaveLength(1);
      expect(useCardboxStore.getState().notes.u1?.body).toBe("abc");

      // Undo should restore to the state before the FIRST setNote (no note)
      await useCardboxUndoStore.getState().undo();
      expect(useCardboxStore.getState().notes.u1).toBeUndefined();
    });

    it("setNote on different cards does not coalesce", async () => {
      await useCardboxStore.getState().setNote("u1", "a");
      await useCardboxStore.getState().setNote("u2", "b");
      expect(useCardboxUndoStore.getState().undoStack).toHaveLength(2);
    });
  });
});
