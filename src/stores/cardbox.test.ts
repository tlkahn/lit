import { describe, it, expect, beforeEach, vi } from "vitest";
import { useCardboxStore } from "./cardbox";
import { useCardboxUndoStore } from "./cardboxUndo";
import { mockInvoke } from "../test/tauri-mock";
import type { CardboxAnnotation, GroupInfo } from "../lib/ipc";

const MOCK_ANNOTATIONS: CardboxAnnotation[] = [
  {
    uuid: "u1",
    annotation_type: "note",
    certainty: "neutral",
    body: "First note",
    date: null,
    source_page_id: "a.md",
    source_page_title: "Alpha",
    source_line: 1,
    char_start: 0,
    char_end: 10,
    scope_kind: "words",
    scope_value: "1",
    original: null,
  },
  {
    uuid: "u2",
    annotation_type: "question",
    certainty: "tentative",
    body: "Why?",
    date: "2026-06-15",
    source_page_id: "b.md",
    source_page_title: "Beta",
    source_line: 5,
    char_start: 20,
    char_end: 30,
    scope_kind: "paragraph",
    scope_value: "1",
    original: null,
  },
];

describe("cardbox store", () => {
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
      pendingFocusUuid: null,
      scope: "document",
    });
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return MOCK_ANNOTATIONS;
      if (cmd === "read_cardbox_layout")
        return { version: 3, order: ["u1", "u2"], links: [["u1", "u2"]], groups: {}, pinned: ["u1"] };
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
      if (cmd === "set_card_color") return null;
      if (cmd === "clear_card_color") return null;
      return null;
    });
  });

  it("initializes with empty annotations, null expandedUuid, loading false", () => {
    const state = useCardboxStore.getState();
    expect(state.annotations).toEqual([]);
    expect(state.expandedUuid).toBeNull();
    expect(state.loading).toBe(false);
  });

  it("fetchAnnotations populates annotations from IPC", async () => {
    await useCardboxStore.getState().fetchAnnotations();
    const state = useCardboxStore.getState();
    expect(state.annotations).toHaveLength(2);
    expect(state.annotations[0]!.uuid).toBe("u1");
    expect(state.annotations[1]!.uuid).toBe("u2");
    expect(state.loading).toBe(false);
  });

  it("fetchAnnotations sets loading true while fetching", async () => {
    const promise = useCardboxStore.getState().fetchAnnotations();
    // loading is set synchronously before the await
    expect(useCardboxStore.getState().loading).toBe(true);
    await promise;
    expect(useCardboxStore.getState().loading).toBe(false);
  });

  it("fetchAnnotations handles errors gracefully", async () => {
    mockInvoke(() => {
      throw new Error("IPC failure");
    });
    await useCardboxStore.getState().fetchAnnotations();
    const state = useCardboxStore.getState();
    expect(state.annotations).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("toggleExpand sets expandedUuid", () => {
    useCardboxStore.getState().toggleExpand("u1");
    expect(useCardboxStore.getState().expandedUuid).toBe("u1");
  });

  it("toggleExpand collapses when same uuid toggled again", () => {
    useCardboxStore.getState().toggleExpand("u1");
    useCardboxStore.getState().toggleExpand("u1");
    expect(useCardboxStore.getState().expandedUuid).toBeNull();
  });

  it("toggleExpand switches to new uuid", () => {
    useCardboxStore.getState().toggleExpand("u1");
    useCardboxStore.getState().toggleExpand("u2");
    expect(useCardboxStore.getState().expandedUuid).toBe("u2");
  });

  it("collapseAll resets expandedUuid to null", () => {
    useCardboxStore.getState().toggleExpand("u1");
    useCardboxStore.getState().collapseAll();
    expect(useCardboxStore.getState().expandedUuid).toBeNull();
  });

  it("fetchAnnotations initializes activeTypes from annotation types", async () => {
    await useCardboxStore.getState().fetchAnnotations();
    const state = useCardboxStore.getState();
    expect(state.activeTypes).toEqual(new Set(["note", "question"]));
  });

  it("setSearchQuery updates searchQuery", () => {
    useCardboxStore.getState().setSearchQuery("hello");
    expect(useCardboxStore.getState().searchQuery).toBe("hello");
  });

  it("toggleType removes a type from activeTypes", () => {
    useCardboxStore.setState({ activeTypes: new Set(["note", "question"]) });
    useCardboxStore.getState().toggleType("note");
    expect(useCardboxStore.getState().activeTypes).toEqual(
      new Set(["question"]),
    );
  });

  it("toggleType adds a type back to activeTypes", () => {
    useCardboxStore.setState({ activeTypes: new Set(["question"]) });
    useCardboxStore.getState().toggleType("note");
    expect(useCardboxStore.getState().activeTypes).toEqual(
      new Set(["question", "note"]),
    );
  });

  it("default scope is document", () => {
    expect(useCardboxStore.getState().scope).toBe("document");
  });

  it("setScope updates scope to workspace", () => {
    useCardboxStore.getState().setScope("workspace");
    expect(useCardboxStore.getState().scope).toBe("workspace");
  });

  it("resetFilters resets scope to document", () => {
    useCardboxStore.getState().setScope("workspace");
    useCardboxStore.getState().resetFilters();
    expect(useCardboxStore.getState().scope).toBe("document");
  });

  it("resetFilters clears searchQuery and sets activeTypes to all", async () => {
    await useCardboxStore.getState().fetchAnnotations();
    useCardboxStore.getState().setSearchQuery("test");
    useCardboxStore.getState().toggleType("note");
    useCardboxStore.getState().resetFilters();
    const state = useCardboxStore.getState();
    expect(state.searchQuery).toBe("");
    expect(state.activeTypes).toEqual(new Set(["note", "question"]));
  });

  it("fetchAnnotations preserves user's activeTypes on refresh", async () => {
    await useCardboxStore.getState().fetchAnnotations();
    useCardboxStore.getState().toggleType("note");
    // Re-fetch (simulates graph-updated refresh)
    await useCardboxStore.getState().fetchAnnotations();
    // activeTypes should be preserved, not reset
    expect(useCardboxStore.getState().activeTypes).toEqual(
      new Set(["question"]),
    );
  });

  it("setOrder updates order array", () => {
    useCardboxStore.getState().setOrder(["u2", "u1"]);
    expect(useCardboxStore.getState().order).toEqual(["u2", "u1"]);
  });

  it("fetchAnnotations initializes order from annotation UUIDs on first load", async () => {
    await useCardboxStore.getState().fetchAnnotations();
    expect(useCardboxStore.getState().order).toEqual(["u1", "u2"]);
  });

  it("fetchAnnotations preserves existing order on refresh", async () => {
    await useCardboxStore.getState().fetchAnnotations();
    // Simulate user reorder
    useCardboxStore.getState().setOrder(["u2", "u1"]);
    // Re-fetch
    await useCardboxStore.getState().fetchAnnotations();
    // Order should be preserved, not reset
    expect(useCardboxStore.getState().order).toEqual(["u2", "u1"]);
  });

  // --- Link tests ---

  it("loadLayout populates links", async () => {
    await useCardboxStore.getState().loadLayout();
    const state = useCardboxStore.getState();
    expect(state.links).toEqual([["u1", "u2"]]);
  });

  it("addLink updates local state", async () => {
    await useCardboxStore.getState().addLink("u2", "u1");
    const state = useCardboxStore.getState();
    expect(state.links).toEqual([["u1", "u2"]]);
  });

  it("addLink prevents duplicates", async () => {
    await useCardboxStore.getState().addLink("u1", "u2");
    await useCardboxStore.getState().addLink("u2", "u1");
    const state = useCardboxStore.getState();
    expect(state.links).toHaveLength(1);
  });

  it("addLink calls IPC", async () => {
    const invokeSpy = vi.fn().mockResolvedValue(null);
    mockInvoke((cmd, args) => {
      invokeSpy(cmd, args);
      return null;
    });
    await useCardboxStore.getState().addLink("u1", "u2");
    expect(invokeSpy).toHaveBeenCalledWith("add_cardbox_link", {
      a: "u1",
      b: "u2",
    });
  });

  it("removeLink updates local state", async () => {
    useCardboxStore.setState({ links: [["u1", "u2"]] });
    await useCardboxStore.getState().removeLink("u1", "u2");
    expect(useCardboxStore.getState().links).toEqual([]);
  });

  it("removeLink calls IPC", async () => {
    const invokeSpy = vi.fn().mockResolvedValue(null);
    mockInvoke((cmd, args) => {
      invokeSpy(cmd, args);
      return null;
    });
    useCardboxStore.setState({ links: [["u1", "u2"]] });
    await useCardboxStore.getState().removeLink("u1", "u2");
    expect(invokeSpy).toHaveBeenCalledWith("remove_cardbox_link", {
      a: "u1",
      b: "u2",
    });
  });

  it("saveLayout includes links and pinned", async () => {
    const invokeSpy = vi.fn().mockResolvedValue(null);
    mockInvoke((cmd, args) => {
      invokeSpy(cmd, args);
      return null;
    });
    useCardboxStore.setState({
      order: ["u1", "u2"],
      links: [["u1", "u2"]],
      pinned: [],
    });
    await useCardboxStore.getState().saveLayout();
    expect(invokeSpy).toHaveBeenCalledWith("write_cardbox_layout", {
      layout: { version: 3, order: ["u1", "u2"], links: [["u1", "u2"]], groups: {}, pinned: [], notes: {}, colors: {} },
    });
  });

  it("fetchAnnotations prunes stale links", async () => {
    useCardboxStore.setState({
      links: [
        ["u1", "u2"],
        ["u1", "stale-uuid"],
      ],
    });
    await useCardboxStore.getState().fetchAnnotations();
    expect(useCardboxStore.getState().links).toEqual([["u1", "u2"]]);
  });

  it("links survive annotation refresh", async () => {
    useCardboxStore.setState({ links: [["u1", "u2"]] });
    await useCardboxStore.getState().fetchAnnotations();
    expect(useCardboxStore.getState().links).toEqual([["u1", "u2"]]);
  });

  // --- Group round-trip tests ---

  it("loadLayout stores groups from backend", async () => {
    const groups: Record<string, GroupInfo> = {
      g1: { name: "My Group", order: ["u1"], collapsed: false },
    };
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return MOCK_ANNOTATIONS;
      if (cmd === "read_cardbox_layout")
        return { version: 3, order: ["group:g1", "u2"], links: [], groups };
      return null;
    });
    await useCardboxStore.getState().loadLayout();
    const state = useCardboxStore.getState();
    expect(state.groups).toEqual(groups);
    expect(state.order).toEqual(["group:g1", "u2"]);
  });

  it("saveLayout passes stored groups and uses version 3 when groups exist", async () => {
    const invokeSpy = vi.fn().mockResolvedValue(null);
    mockInvoke((cmd, args) => {
      invokeSpy(cmd, args);
      return null;
    });
    const groups: Record<string, GroupInfo> = {
      g1: { name: "My Group", order: ["u1"], collapsed: false },
    };
    useCardboxStore.setState({
      order: ["group:g1", "u2"],
      links: [],
      groups,
    });
    await useCardboxStore.getState().saveLayout();
    expect(invokeSpy).toHaveBeenCalledWith("write_cardbox_layout", {
      layout: { version: 3, order: ["group:g1", "u2"], links: [], groups, pinned: [], notes: {}, colors: {} },
    });
  });

  it("saveLayout uses version 3 when groups is empty", async () => {
    const invokeSpy = vi.fn().mockResolvedValue(null);
    mockInvoke((cmd, args) => {
      invokeSpy(cmd, args);
      return null;
    });
    useCardboxStore.setState({
      order: ["u1", "u2"],
      links: [],
      groups: {},
    });
    await useCardboxStore.getState().saveLayout();
    expect(invokeSpy).toHaveBeenCalledWith("write_cardbox_layout", {
      layout: { version: 3, order: ["u1", "u2"], links: [], groups: {}, pinned: [], notes: {}, colors: {} },
    });
  });

  it("fetchAnnotations preserves group:xxx entries in order", async () => {
    const groups: Record<string, GroupInfo> = {
      g1: { name: "My Group", order: ["u1"], collapsed: false },
    };
    useCardboxStore.setState({
      order: ["group:g1", "u2"],
      groups,
    });
    await useCardboxStore.getState().fetchAnnotations();
    const state = useCardboxStore.getState();
    expect(state.order).toContain("group:g1");
    expect(state.order).toContain("u2");
  });

  it("fetchAnnotations prunes stale members from groups", async () => {
    const groups: Record<string, GroupInfo> = {
      g1: { name: "My Group", order: ["u1", "stale-uuid"], collapsed: false },
    };
    useCardboxStore.setState({
      order: ["group:g1", "u2"],
      groups,
    });
    await useCardboxStore.getState().fetchAnnotations();
    const state = useCardboxStore.getState();
    expect(state.groups.g1!.order).toEqual(["u1"]);
  });

  it("fetchAnnotations removes groups that become empty after pruning", async () => {
    const groups: Record<string, GroupInfo> = {
      g1: { name: "Stale Group", order: ["stale-uuid"], collapsed: false },
    };
    useCardboxStore.setState({
      order: ["group:g1", "u1", "u2"],
      groups,
    });
    await useCardboxStore.getState().fetchAnnotations();
    const state = useCardboxStore.getState();
    expect(state.groups).toEqual({});
    expect(state.order).not.toContain("group:g1");
  });

  it("loadLayout handles backend response without groups field", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return MOCK_ANNOTATIONS;
      if (cmd === "read_cardbox_layout")
        return { version: 2, order: ["u1", "u2"], links: [] };
      return null;
    });
    await useCardboxStore.getState().loadLayout();
    const state = useCardboxStore.getState();
    expect(state.groups).toEqual({});
  });

  // --- Group action tests ---

  describe("group actions", () => {
    it("createGroup moves cards into new group and adds group entry to order", async () => {
      useCardboxStore.setState({
        order: ["u1", "u2", "u3"],
        groups: {},
      });
      await useCardboxStore.getState().createGroup("g1", "My Group", ["u1", "u3"]);
      const s = useCardboxStore.getState();
      expect(s.order).toEqual(["u2", "group:g1"]);
      expect(s.groups.g1).toEqual({ name: "My Group", order: ["u1", "u3"], collapsed: false });
    });

    it("createGroup with afterEntry inserts group after specified entry", async () => {
      useCardboxStore.setState({
        order: ["u1", "u2", "u3"],
        groups: {},
      });
      await useCardboxStore.getState().createGroup("g1", "My Group", ["u3"], "u1");
      const s = useCardboxStore.getState();
      expect(s.order).toEqual(["u1", "group:g1", "u2"]);
    });

    it("createGroup_afterEntry_is_grouped_card inserts at correct position", async () => {
      useCardboxStore.setState({
        order: ["u1", "u2", "u3"],
        groups: {},
      });
      // afterEntry is "u2" which is also one of the cards being grouped
      await useCardboxStore.getState().createGroup("g1", "My Group", ["u2", "u3"], "u2");
      const s = useCardboxStore.getState();
      // u2 was at index 1 in original order; it's being removed so precedingRemovals=1
      // insertIdx = 1 + 1 - 1 = 1; after removal order is ["u1"], so group inserts at index 1
      expect(s.order).toEqual(["u1", "group:g1"]);
      expect(s.groups.g1).toEqual({ name: "My Group", order: ["u2", "u3"], collapsed: false });
    });

    it("createGroup with afterEntry preceding grouped cards computes correct index", async () => {
      useCardboxStore.setState({
        order: ["u1", "u2", "u3", "u4"],
        groups: {},
      });
      // Group u1 and u3; afterEntry is u2 (not being grouped)
      // u1 is at index 0 <= u2's index 1, so precedingRemovals=1
      // insertIdx = 1 + 1 - 1 = 1; after removal order is ["u2", "u4"]
      await useCardboxStore.getState().createGroup("g1", "G", ["u1", "u3"], "u2");
      const s = useCardboxStore.getState();
      expect(s.order).toEqual(["u2", "group:g1", "u4"]);
    });

    it("createGroup calls IPC with correct args", async () => {
      const invokeSpy = vi.fn().mockResolvedValue(null);
      mockInvoke((cmd, args) => {
        invokeSpy(cmd, args);
        return null;
      });
      useCardboxStore.setState({ order: ["u1", "u2"], groups: {} });
      await useCardboxStore.getState().createGroup("g1", "Test", ["u1"], "u2");
      expect(invokeSpy).toHaveBeenCalledWith("create_cardbox_group", {
        groupId: "g1",
        name: "Test",
        cardUuids: ["u1"],
        afterEntry: "u2",
      });
    });

    it("renameGroup updates the group name", async () => {
      useCardboxStore.setState({
        order: ["group:g1", "u2"],
        groups: { g1: { name: "Old", order: ["u1"], collapsed: false } },
      });
      await useCardboxStore.getState().renameGroup("g1", "New Name");
      const s = useCardboxStore.getState();
      expect(s.groups.g1!.name).toBe("New Name");
      expect(s.groups.g1!.order).toEqual(["u1"]);
      expect(s.groups.g1!.collapsed).toBe(false);
    });

    it("renameGroup no-ops for nonexistent group", async () => {
      useCardboxStore.setState({
        order: ["u1"],
        groups: {},
      });
      await useCardboxStore.getState().renameGroup("missing", "X");
      expect(useCardboxStore.getState().groups).toEqual({});
    });

    it("dissolveGroup splices members back into order at group position", async () => {
      useCardboxStore.setState({
        order: ["u3", "group:g1", "u4"],
        groups: { g1: { name: "G", order: ["u1", "u2"], collapsed: false } },
      });
      await useCardboxStore.getState().dissolveGroup("g1");
      const s = useCardboxStore.getState();
      expect(s.order).toEqual(["u3", "u1", "u2", "u4"]);
      expect(s.groups.g1).toBeUndefined();
    });

    it("dissolveGroup calls IPC with correct args", async () => {
      const invokeSpy = vi.fn().mockResolvedValue(null);
      mockInvoke((cmd, args) => {
        invokeSpy(cmd, args);
        return null;
      });
      useCardboxStore.setState({
        order: ["group:g1"],
        groups: { g1: { name: "G", order: ["u1"], collapsed: false } },
      });
      await useCardboxStore.getState().dissolveGroup("g1");
      expect(invokeSpy).toHaveBeenCalledWith("dissolve_cardbox_group", {
        groupId: "g1",
      });
    });

    it("moveCardToGroup moves card from top-level into group", async () => {
      useCardboxStore.setState({
        order: ["u1", "group:g1", "u2"],
        groups: { g1: { name: "G", order: ["u3"], collapsed: false } },
      });
      await useCardboxStore.getState().moveCardToGroup("u2", "g1");
      const s = useCardboxStore.getState();
      expect(s.order).toEqual(["u1", "group:g1"]);
      expect(s.groups.g1!.order).toEqual(["u3", "u2"]);
    });

    it("moveCardToGroup moves card between groups", async () => {
      useCardboxStore.setState({
        order: ["group:g1", "group:g2"],
        groups: {
          g1: { name: "G1", order: ["u1", "u2"], collapsed: false },
          g2: { name: "G2", order: ["u3"], collapsed: false },
        },
      });
      await useCardboxStore.getState().moveCardToGroup("u1", "g2", 0);
      const s = useCardboxStore.getState();
      expect(s.groups.g1!.order).toEqual(["u2"]);
      expect(s.groups.g2!.order).toEqual(["u1", "u3"]);
    });

    it("removeCardFromGroup moves card to top-level", async () => {
      useCardboxStore.setState({
        order: ["group:g1", "u3"],
        groups: { g1: { name: "G", order: ["u1", "u2"], collapsed: false } },
      });
      await useCardboxStore.getState().removeCardFromGroup("u1", "g1");
      const s = useCardboxStore.getState();
      expect(s.groups.g1!.order).toEqual(["u2"]);
      expect(s.order).toContain("u1");
    });

    it("removeCardFromGroup auto-dissolves group when last card removed", async () => {
      useCardboxStore.setState({
        order: ["group:g1", "u2"],
        groups: { g1: { name: "G", order: ["u1"], collapsed: false } },
      });
      await useCardboxStore.getState().removeCardFromGroup("u1", "g1");
      const s = useCardboxStore.getState();
      expect(s.groups.g1).toBeUndefined();
      expect(s.order).not.toContain("group:g1");
      expect(s.order).toContain("u1");
    });

    it("removeCardFromGroup inserts at specified topLevelIndex", async () => {
      useCardboxStore.setState({
        order: ["u3", "group:g1", "u4"],
        groups: { g1: { name: "G", order: ["u1", "u2"], collapsed: false } },
      });
      await useCardboxStore.getState().removeCardFromGroup("u1", "g1", 0);
      const s = useCardboxStore.getState();
      expect(s.order[0]).toBe("u1");
      expect(s.groups.g1!.order).toEqual(["u2"]);
    });

    it("toggleGroupCollapse toggles collapsed flag", async () => {
      useCardboxStore.setState({
        order: ["group:g1"],
        groups: { g1: { name: "G", order: ["u1"], collapsed: false } },
      });
      await useCardboxStore.getState().toggleGroupCollapse("g1");
      expect(useCardboxStore.getState().groups.g1!.collapsed).toBe(true);
      await useCardboxStore.getState().toggleGroupCollapse("g1");
      expect(useCardboxStore.getState().groups.g1!.collapsed).toBe(false);
    });

    it("toggleGroupCollapse calls IPC with computed boolean", async () => {
      const invokeSpy = vi.fn().mockResolvedValue(null);
      mockInvoke((cmd, args) => {
        invokeSpy(cmd, args);
        return null;
      });
      useCardboxStore.setState({
        order: ["group:g1"],
        groups: { g1: { name: "G", order: ["u1"], collapsed: false } },
      });
      await useCardboxStore.getState().toggleGroupCollapse("g1");
      expect(invokeSpy).toHaveBeenCalledWith("toggle_group_collapsed", {
        groupId: "g1",
        collapsed: true,
      });
    });

    it("reorderWithinGroup swaps card positions within a group", () => {
      useCardboxStore.setState({
        order: ["group:g1"],
        groups: { g1: { name: "G", order: ["u1", "u2", "u3"], collapsed: false } },
      });
      useCardboxStore.getState().reorderWithinGroup("g1", "u1", "u3");
      const s = useCardboxStore.getState();
      expect(s.groups.g1!.order).toEqual(["u2", "u3", "u1"]);
    });

    it("reorderWithinGroup no-ops for nonexistent group", () => {
      useCardboxStore.setState({
        order: ["group:g1"],
        groups: { g1: { name: "G", order: ["u1", "u2"], collapsed: false } },
      });
      useCardboxStore.getState().reorderWithinGroup("missing", "u1", "u2");
      // Original state unchanged
      expect(useCardboxStore.getState().groups.g1!.order).toEqual(["u1", "u2"]);
    });

    it("reorderWithinGroup no-ops when uuid not found in group", () => {
      useCardboxStore.setState({
        order: ["group:g1"],
        groups: { g1: { name: "G", order: ["u1", "u2"], collapsed: false } },
      });
      useCardboxStore.getState().reorderWithinGroup("g1", "u1", "u3");
      expect(useCardboxStore.getState().groups.g1!.order).toEqual(["u1", "u2"]);
    });

    it("reorderWithinGroup moves card forward", () => {
      useCardboxStore.setState({
        order: ["group:g1"],
        groups: { g1: { name: "G", order: ["u1", "u2", "u3"], collapsed: false } },
      });
      useCardboxStore.getState().reorderWithinGroup("g1", "u3", "u1");
      const s = useCardboxStore.getState();
      expect(s.groups.g1!.order).toEqual(["u3", "u1", "u2"]);
    });
  });

  // --- Pin tests ---

  it("pinCard adds uuid to pinned and calls IPC", async () => {
    const invokeSpy = vi.fn().mockResolvedValue(null);
    mockInvoke((cmd, args) => {
      invokeSpy(cmd, args);
      return null;
    });
    await useCardboxStore.getState().pinCard("u1");
    expect(useCardboxStore.getState().pinned).toEqual(["u1"]);
    expect(invokeSpy).toHaveBeenCalledWith("pin_cardbox_card", { uuid: "u1" });
  });

  it("pinCard is idempotent", async () => {
    await useCardboxStore.getState().pinCard("u1");
    await useCardboxStore.getState().pinCard("u1");
    expect(useCardboxStore.getState().pinned).toEqual(["u1"]);
  });

  it("unpinCard removes uuid from pinned and calls IPC", async () => {
    const invokeSpy = vi.fn().mockResolvedValue(null);
    mockInvoke((cmd, args) => {
      invokeSpy(cmd, args);
      return null;
    });
    useCardboxStore.setState({ pinned: ["u1", "u2"] });
    await useCardboxStore.getState().unpinCard("u1");
    expect(useCardboxStore.getState().pinned).toEqual(["u2"]);
    expect(invokeSpy).toHaveBeenCalledWith("unpin_cardbox_card", { uuid: "u1" });
  });

  it("unpinCard is noop for non-pinned uuid", async () => {
    useCardboxStore.setState({ pinned: ["u1"] });
    await useCardboxStore.getState().unpinCard("u99");
    expect(useCardboxStore.getState().pinned).toEqual(["u1"]);
  });

  it("loadLayout populates pinned", async () => {
    await useCardboxStore.getState().loadLayout();
    expect(useCardboxStore.getState().pinned).toEqual(["u1"]);
  });

  // --- Connections mode tests ---

  describe("connections mode", () => {
    it("enterConnections saves filters and sets connectionsForUuid", async () => {
      await useCardboxStore.getState().fetchAnnotations();
      useCardboxStore.getState().setSearchQuery("test");
      useCardboxStore.getState().enterConnections("u1");
      const s = useCardboxStore.getState();
      expect(s.connectionsForUuid).toBe("u1");
      expect(s.searchQuery).toBe("");
      expect(s.activeTypes).toBeNull();
      expect(s.connectionsSavedFilters).toEqual({
        searchQuery: "test",
        activeTypes: new Set(["note", "question"]),
      });
    });

    it("enterConnections preserves original saved filters when switching cards", () => {
      useCardboxStore.setState({
        searchQuery: "original",
        activeTypes: new Set(["note", "question"]),
      });
      useCardboxStore.getState().enterConnections("u1");
      useCardboxStore.getState().enterConnections("u2");
      const s = useCardboxStore.getState();
      expect(s.connectionsForUuid).toBe("u2");
      expect(s.connectionsSavedFilters).toEqual({
        searchQuery: "original",
        activeTypes: new Set(["note", "question"]),
      });
    });

    it("exitConnections restores saved filters", async () => {
      await useCardboxStore.getState().fetchAnnotations();
      useCardboxStore.getState().setSearchQuery("test");
      useCardboxStore.getState().enterConnections("u1");
      useCardboxStore.getState().exitConnections();
      const s = useCardboxStore.getState();
      expect(s.connectionsForUuid).toBeNull();
      expect(s.connectionsSavedFilters).toBeNull();
      expect(s.searchQuery).toBe("test");
      expect(s.activeTypes).toEqual(new Set(["note", "question"]));
    });

    it("exitConnections with no saved filters falls back to defaults", () => {
      useCardboxStore.setState({ connectionsForUuid: "u1", connectionsSavedFilters: null });
      useCardboxStore.getState().exitConnections();
      const s = useCardboxStore.getState();
      expect(s.searchQuery).toBe("");
      expect(s.activeTypes).toBeNull();
    });

    it("resetFilters clears connections mode", async () => {
      await useCardboxStore.getState().fetchAnnotations();
      useCardboxStore.getState().enterConnections("u1");
      useCardboxStore.getState().resetFilters();
      const s = useCardboxStore.getState();
      expect(s.connectionsForUuid).toBeNull();
      expect(s.connectionsSavedFilters).toBeNull();
    });

    it("fetchAnnotations clears connections when focused card is deleted", async () => {
      useCardboxStore.setState({
        connectionsForUuid: "stale-uuid",
        connectionsSavedFilters: { searchQuery: "", activeTypes: null },
      });
      await useCardboxStore.getState().fetchAnnotations();
      const s = useCardboxStore.getState();
      expect(s.connectionsForUuid).toBeNull();
      expect(s.connectionsSavedFilters).toBeNull();
    });

    it("fetchAnnotations restores saved filters when target is pruned", async () => {
      useCardboxStore.setState({
        searchQuery: "during-connections",
        activeTypes: null,
        connectionsForUuid: "stale-uuid",
        connectionsSavedFilters: { searchQuery: "original", activeTypes: new Set(["note"]) },
      });
      await useCardboxStore.getState().fetchAnnotations();
      const s = useCardboxStore.getState();
      expect(s.connectionsForUuid).toBeNull();
      expect(s.connectionsSavedFilters).toBeNull();
      expect(s.searchQuery).toBe("original");
      expect(s.activeTypes).toEqual(new Set(["note"]));
    });

    it("fetchAnnotations falls back to current filters when saved filters are null on prune", async () => {
      useCardboxStore.setState({
        searchQuery: "during-connections",
        activeTypes: null,
        connectionsForUuid: "stale-uuid",
        connectionsSavedFilters: null,
      });
      await useCardboxStore.getState().fetchAnnotations();
      const s = useCardboxStore.getState();
      expect(s.connectionsForUuid).toBeNull();
      expect(s.searchQuery).toBe("during-connections");
      // activeTypes falls back to all types since savedFilters is null
      expect(s.activeTypes).toEqual(new Set(["note", "question"]));
    });

    it("fetchAnnotations preserves connections when focused card still exists", async () => {
      useCardboxStore.setState({
        connectionsForUuid: "u1",
        connectionsSavedFilters: { searchQuery: "old", activeTypes: null },
      });
      await useCardboxStore.getState().fetchAnnotations();
      const s = useCardboxStore.getState();
      expect(s.connectionsForUuid).toBe("u1");
      expect(s.connectionsSavedFilters).toEqual({ searchQuery: "old", activeTypes: null });
    });

    it("fetchAnnotations does not overwrite activeTypes=null during connections mode", async () => {
      useCardboxStore.setState({
        connectionsForUuid: "u1",
        activeTypes: null,
        connectionsSavedFilters: { searchQuery: "", activeTypes: new Set(["note"]) },
      });
      await useCardboxStore.getState().fetchAnnotations();
      const s = useCardboxStore.getState();
      expect(s.activeTypes).toBeNull();
    });
  });

  it("setPinned updates pinned array", () => {
    useCardboxStore.getState().setPinned(["u2", "u1"]);
    expect(useCardboxStore.getState().pinned).toEqual(["u2", "u1"]);
  });

  it("fetchAnnotations prunes stale pinned", async () => {
    useCardboxStore.setState({ pinned: ["u1", "stale-uuid"] });
    await useCardboxStore.getState().fetchAnnotations();
    expect(useCardboxStore.getState().pinned).toEqual(["u1"]);
  });

  // --- batchMoveCards tests ---

  describe("batchMoveCards", () => {
    it("moves multiple top-level cards to a new position", () => {
      useCardboxStore.setState({
        order: ["u1", "u2", "u3", "u4"],
        groups: {},
      });
      useCardboxStore.getState().batchMoveCards(["u1", "u3"], { type: "topLevel", insertAtIndex: 2 });
      const s = useCardboxStore.getState();
      expect(s.order).toEqual(["u2", "u4", "u1", "u3"]);
    });

    it("moves cards to the beginning", () => {
      useCardboxStore.setState({
        order: ["u1", "u2", "u3"],
        groups: {},
      });
      useCardboxStore.getState().batchMoveCards(["u3"], { type: "topLevel", insertAtIndex: 0 });
      expect(useCardboxStore.getState().order).toEqual(["u3", "u1", "u2"]);
    });

    it("moves top-level cards into a group", () => {
      useCardboxStore.setState({
        order: ["u1", "u2", "group:g1", "u3"],
        groups: { g1: { name: "G", order: ["u4"], collapsed: false } },
      });
      useCardboxStore.getState().batchMoveCards(["u1", "u3"], { type: "toGroup", groupId: "g1" });
      const s = useCardboxStore.getState();
      expect(s.order).toEqual(["u2", "group:g1"]);
      expect(s.groups.g1!.order).toEqual(["u4", "u1", "u3"]);
    });

    it("moves cards into a group at a specific index", () => {
      useCardboxStore.setState({
        order: ["u1", "u2", "group:g1"],
        groups: { g1: { name: "G", order: ["u3", "u4"], collapsed: false } },
      });
      useCardboxStore.getState().batchMoveCards(["u1", "u2"], { type: "toGroup", groupId: "g1", index: 1 });
      const s = useCardboxStore.getState();
      expect(s.groups.g1!.order).toEqual(["u3", "u1", "u2", "u4"]);
    });

    it("moves cards from mixed origins (group + top-level) to top-level", () => {
      useCardboxStore.setState({
        order: ["u1", "group:g1", "u4"],
        groups: { g1: { name: "G", order: ["u2", "u3"], collapsed: false } },
      });
      useCardboxStore.getState().batchMoveCards(["u1", "u2"], { type: "topLevel", insertAtIndex: 1 });
      const s = useCardboxStore.getState();
      expect(s.order).toEqual(["group:g1", "u1", "u2", "u4"]);
      expect(s.groups.g1!.order).toEqual(["u3"]);
    });

    it("auto-dissolves a group left empty after removal", () => {
      useCardboxStore.setState({
        order: ["u1", "group:g1", "u3"],
        groups: { g1: { name: "G", order: ["u2"], collapsed: false } },
      });
      useCardboxStore.getState().batchMoveCards(["u2"], { type: "topLevel", insertAtIndex: 0 });
      const s = useCardboxStore.getState();
      expect(s.groups.g1).toBeUndefined();
      expect(s.order).not.toContain("group:g1");
      expect(s.order).toContain("u2");
    });

    it("moves cards from multiple groups to top-level", () => {
      useCardboxStore.setState({
        order: ["group:g1", "group:g2"],
        groups: {
          g1: { name: "G1", order: ["u1", "u2"], collapsed: false },
          g2: { name: "G2", order: ["u3", "u4"], collapsed: false },
        },
      });
      useCardboxStore.getState().batchMoveCards(["u1", "u3"], { type: "topLevel", insertAtIndex: 0 });
      const s = useCardboxStore.getState();
      expect(s.order[0]).toBe("u1");
      expect(s.order[1]).toBe("u3");
      expect(s.groups.g1!.order).toEqual(["u2"]);
      expect(s.groups.g2!.order).toEqual(["u4"]);
    });

    it("clamps insertAtIndex to array length", () => {
      useCardboxStore.setState({
        order: ["u1", "u2"],
        groups: {},
      });
      useCardboxStore.getState().batchMoveCards(["u1"], { type: "topLevel", insertAtIndex: 100 });
      const s = useCardboxStore.getState();
      expect(s.order).toEqual(["u2", "u1"]);
    });

    it("pushes an undo entry that restores previous state", () => {
      useCardboxStore.setState({
        order: ["u1", "u2", "u3"],
        groups: {},
      });
      useCardboxStore.getState().batchMoveCards(["u1", "u3"], { type: "topLevel", insertAtIndex: 1 });
      expect(useCardboxStore.getState().order).toEqual(["u2", "u1", "u3"]);

      const stack = useCardboxUndoStore.getState().undoStack;
      expect(stack.length).toBeGreaterThan(0);
    });
  });

  describe("pendingFocusUuid", () => {
    it("initializes as null", () => {
      expect(useCardboxStore.getState().pendingFocusUuid).toBeNull();
    });

    it("setPendingFocusUuid sets the uuid", () => {
      useCardboxStore.getState().setPendingFocusUuid("u1");
      expect(useCardboxStore.getState().pendingFocusUuid).toBe("u1");
    });

    it("setPendingFocusUuid(null) clears the uuid", () => {
      useCardboxStore.getState().setPendingFocusUuid("u1");
      useCardboxStore.getState().setPendingFocusUuid(null);
      expect(useCardboxStore.getState().pendingFocusUuid).toBeNull();
    });
  });
});
