import { describe, it, expect, beforeEach, vi } from "vitest";
import { useCardboxStore } from "./cardbox";
import { useCardboxUndoStore } from "./cardboxUndo";
import { useStatusMessageStore } from "./statusMessage";
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

const initialCardboxState = useCardboxStore.getState();

describe("cardbox store", () => {
  beforeEach(() => {
    useCardboxStore.setState(initialCardboxState, true);
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return MOCK_ANNOTATIONS;
      if (cmd === "migrate_cardbox_slip_notes")
        return { migrated: 0, failed: 0, skipped: 0, changed_pages: [], failures: [] };
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

  it("expand sets expandedUuid", () => {
    useCardboxStore.getState().expand("u1");
    expect(useCardboxStore.getState().expandedUuid).toBe("u1");
  });

  it("expand keeps already-expanded uuid expanded (idempotent)", () => {
    useCardboxStore.getState().expand("u1");
    useCardboxStore.getState().expand("u1");
    expect(useCardboxStore.getState().expandedUuid).toBe("u1");
  });

  it("expand switches to new uuid", () => {
    useCardboxStore.getState().expand("u1");
    useCardboxStore.getState().expand("u2");
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

  it("resetFilters preserves scope", () => {
    useCardboxStore.getState().setScope("workspace");
    useCardboxStore.getState().resetFilters();
    expect(useCardboxStore.getState().scope).toBe("workspace");
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

  it("loadLayout ignores a persisted order array", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return MOCK_ANNOTATIONS;
      if (cmd === "migrate_cardbox_slip_notes")
        return { migrated: 0, failed: 0, skipped: 0, changed_pages: [], failures: [] };
      if (cmd === "read_cardbox_layout")
        return { version: 3, order: ["u2", "u1"], links: [], groups: {}, pinned: [] };
      return null;
    });
    await useCardboxStore.getState().loadLayout();
    // The manual order is dead (#968): the store no longer carries the field.
    expect("order" in useCardboxStore.getState()).toBe(false);
  });

  it("saveLayout writes an empty order array", async () => {
    const invokeSpy = vi.fn().mockResolvedValue(null);
    mockInvoke((cmd, args) => {
      invokeSpy(cmd, args);
      return null;
    });
    useCardboxStore.setState({
      links: [["u1", "u2"]],
      groups: { g1: { name: "G", order: ["u1"], collapsed: false } },
      pinned: ["u2"],
      colors: { u1: "blue" },
    });
    await useCardboxStore.getState().saveLayout();
    expect(invokeSpy).toHaveBeenCalledWith("write_cardbox_layout", {
      layout: {
        version: 3,
        order: [],
        links: [["u1", "u2"]],
        groups: { g1: { name: "G", order: ["u1"], collapsed: false } },
        pinned: ["u2"],
        notes: {},
        colors: { u1: "blue" },
      },
    });
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
      links: [["u1", "u2"]],
      pinned: [],
    });
    await useCardboxStore.getState().saveLayout();
    expect(invokeSpy).toHaveBeenCalledWith("write_cardbox_layout", {
      layout: { version: 3, order: [], links: [["u1", "u2"]], groups: {}, pinned: [], notes: {}, colors: {} },
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
      links: [],
      groups,
    });
    await useCardboxStore.getState().saveLayout();
    expect(invokeSpy).toHaveBeenCalledWith("write_cardbox_layout", {
      layout: { version: 3, order: [], links: [], groups, pinned: [], notes: {}, colors: {} },
    });
  });

  it("saveLayout uses version 3 when groups is empty", async () => {
    const invokeSpy = vi.fn().mockResolvedValue(null);
    mockInvoke((cmd, args) => {
      invokeSpy(cmd, args);
      return null;
    });
    useCardboxStore.setState({
      links: [],
      groups: {},
    });
    await useCardboxStore.getState().saveLayout();
    expect(invokeSpy).toHaveBeenCalledWith("write_cardbox_layout", {
      layout: { version: 3, order: [], links: [], groups: {}, pinned: [], notes: {}, colors: {} },
    });
  });

  it("fetchAnnotations prunes stale members from groups", async () => {
    const groups: Record<string, GroupInfo> = {
      g1: { name: "My Group", order: ["u1", "stale-uuid"], collapsed: false },
    };
    useCardboxStore.setState({
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
      groups,
    });
    await useCardboxStore.getState().fetchAnnotations();
    const state = useCardboxStore.getState();
    expect(state.groups).toEqual({});
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
    it("createGroup moves cards into the new group without any top-level order bookkeeping", async () => {
      useCardboxStore.setState({ groups: {} });
      await useCardboxStore.getState().createGroup("g1", "My Group", ["u1", "u3"]);
      const s = useCardboxStore.getState();
      expect(s.groups.g1).toEqual({ name: "My Group", order: ["u1", "u3"], collapsed: false });
      expect("order" in s).toBe(false);
    });

    it("createGroup removes its cards from every other group", async () => {
      useCardboxStore.setState({
        groups: { g0: { name: "Old", order: ["u1", "u2"], collapsed: false } },
      });
      await useCardboxStore.getState().createGroup("g1", "New", ["u1"]);
      const s = useCardboxStore.getState();
      expect(s.groups.g0!.order).toEqual(["u2"]);
      expect(s.groups.g1!.order).toEqual(["u1"]);
    });

    it("createGroup calls IPC with correct args", async () => {
      const invokeSpy = vi.fn().mockResolvedValue(null);
      mockInvoke((cmd, args) => {
        invokeSpy(cmd, args);
        return null;
      });
      useCardboxStore.setState({ groups: {} });
      await useCardboxStore.getState().createGroup("g1", "Test", ["u1"]);
      expect(invokeSpy).toHaveBeenCalledWith("create_cardbox_group", {
        groupId: "g1",
        name: "Test",
        cardUuids: ["u1"],
        afterEntry: null,
      });
    });

    it("renameGroup updates the group name", async () => {
      useCardboxStore.setState({
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
        groups: {},
      });
      await useCardboxStore.getState().renameGroup("missing", "X");
      expect(useCardboxStore.getState().groups).toEqual({});
    });

    it("dissolveGroup removes the group", async () => {
      useCardboxStore.setState({
        groups: { g1: { name: "G", order: ["u1", "u2"], collapsed: false } },
      });
      await useCardboxStore.getState().dissolveGroup("g1");
      const s = useCardboxStore.getState();
      expect(s.groups.g1).toBeUndefined();
    });

    it("dissolveGroup calls IPC with correct args", async () => {
      const invokeSpy = vi.fn().mockResolvedValue(null);
      mockInvoke((cmd, args) => {
        invokeSpy(cmd, args);
        return null;
      });
      useCardboxStore.setState({
        groups: { g1: { name: "G", order: ["u1"], collapsed: false } },
      });
      await useCardboxStore.getState().dissolveGroup("g1");
      expect(invokeSpy).toHaveBeenCalledWith("dissolve_cardbox_group", {
        groupId: "g1",
      });
    });

    it("moveCardToGroup moves card from top-level into group", async () => {
      useCardboxStore.setState({
        groups: { g1: { name: "G", order: ["u3"], collapsed: false } },
      });
      await useCardboxStore.getState().moveCardToGroup("u2", "g1");
      const s = useCardboxStore.getState();
      expect(s.groups.g1!.order).toEqual(["u3", "u2"]);
    });

    it("moveCardToGroup moves card between groups", async () => {
      useCardboxStore.setState({
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

    it("removeCardFromGroup removes the card from the group", async () => {
      useCardboxStore.setState({
        groups: { g1: { name: "G", order: ["u1", "u2"], collapsed: false } },
      });
      await useCardboxStore.getState().removeCardFromGroup("u1", "g1");
      const s = useCardboxStore.getState();
      expect(s.groups.g1!.order).toEqual(["u2"]);
    });

    it("removeCardFromGroup auto-dissolves group when last card removed", async () => {
      useCardboxStore.setState({
        groups: { g1: { name: "G", order: ["u1"], collapsed: false } },
      });
      await useCardboxStore.getState().removeCardFromGroup("u1", "g1");
      const s = useCardboxStore.getState();
      expect(s.groups.g1).toBeUndefined();
    });

    it("toggleGroupCollapse toggles collapsed flag", async () => {
      useCardboxStore.setState({
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
        groups: { g1: { name: "G", order: ["u1"], collapsed: false } },
      });
      await useCardboxStore.getState().toggleGroupCollapse("g1");
      expect(invokeSpy).toHaveBeenCalledWith("toggle_group_collapsed", {
        groupId: "g1",
        collapsed: true,
      });
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
    it("moves top-level cards into a group", () => {
      useCardboxStore.setState({
        groups: { g1: { name: "G", order: ["u4"], collapsed: false } },
      });
      useCardboxStore.getState().batchMoveCards(["u1", "u3"], { type: "toGroup", groupId: "g1" });
      const s = useCardboxStore.getState();
      expect(s.groups.g1!.order).toEqual(["u4", "u1", "u3"]);
    });

    it("moves cards into a group at a specific index", () => {
      useCardboxStore.setState({
        groups: { g1: { name: "G", order: ["u3", "u4"], collapsed: false } },
      });
      useCardboxStore.getState().batchMoveCards(["u1", "u2"], { type: "toGroup", groupId: "g1", index: 1 });
      const s = useCardboxStore.getState();
      expect(s.groups.g1!.order).toEqual(["u3", "u1", "u2", "u4"]);
    });

    it("moves cards from mixed origins (group + top-level) into a group", () => {
      useCardboxStore.setState({
        groups: {
          g1: { name: "G1", order: ["u2", "u3"], collapsed: false },
          g2: { name: "G2", order: ["u4"], collapsed: false },
        },
      });
      useCardboxStore.getState().batchMoveCards(["u1", "u2"], { type: "toGroup", groupId: "g2" });
      const s = useCardboxStore.getState();
      expect(s.groups.g1!.order).toEqual(["u3"]);
      expect(s.groups.g2!.order).toEqual(["u4", "u1", "u2"]);
    });

    it("auto-dissolves a group left empty after moving its last card away", () => {
      useCardboxStore.setState({
        groups: {
          g1: { name: "G1", order: ["u2"], collapsed: false },
          g2: { name: "G2", order: ["u4"], collapsed: false },
        },
      });
      useCardboxStore.getState().batchMoveCards(["u2"], { type: "toGroup", groupId: "g2" });
      const s = useCardboxStore.getState();
      expect(s.groups.g1).toBeUndefined();
      expect(s.groups.g2!.order).toEqual(["u4", "u2"]);
    });

    it("preserves the target group when its full membership is moved onto itself", () => {
      useCardboxStore.setState({
        groups: { g1: { name: "G", order: ["u1", "u2"], collapsed: false } },
      });
      useCardboxStore.getState().batchMoveCards(["u1", "u2"], { type: "toGroup", groupId: "g1" });
      const s = useCardboxStore.getState();
      expect(s.groups.g1).toBeDefined();
      expect(s.groups.g1!.order).toEqual(["u1", "u2"]);
    });

    it("appends outside cards when the target group's own members are part of the move", () => {
      useCardboxStore.setState({
        groups: { g1: { name: "G", order: ["u1", "u2"], collapsed: false } },
      });
      useCardboxStore.getState().batchMoveCards(["u1", "u2", "u3"], { type: "toGroup", groupId: "g1" });
      const s = useCardboxStore.getState();
      expect(s.groups.g1!.order).toEqual(["u1", "u2", "u3"]);
    });

    it("undo restores membership after moving a group's cards onto the same group", async () => {
      useCardboxUndoStore.getState().clear();
      useCardboxStore.setState({
        groups: { g1: { name: "G", order: ["u2", "u1"], collapsed: false } },
      });
      useCardboxStore.getState().batchMoveCards(["u2", "u1"], { type: "toGroup", groupId: "g1" });
      await useCardboxUndoStore.getState().undo();
      const s = useCardboxStore.getState();
      expect(s.groups.g1!.order).toEqual(["u2", "u1"]);
    });

    it("pushes an undo entry that restores previous state", () => {
      useCardboxStore.setState({
        groups: { g1: { name: "G", order: ["u4"], collapsed: false } },
      });
      useCardboxStore.getState().batchMoveCards(["u1", "u3"], { type: "toGroup", groupId: "g1" });
      expect(useCardboxStore.getState().groups.g1!.order).toEqual(["u4", "u1", "u3"]);

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

    it("pendingHighlightNote defaults to false", () => {
      expect(useCardboxStore.getState().pendingHighlightNote).toBe(false);
    });

    it("setPendingFocusUuid with highlightNote=true sets pendingHighlightNote", () => {
      useCardboxStore.getState().setPendingFocusUuid("u1", true);
      const s = useCardboxStore.getState();
      expect(s.pendingFocusUuid).toBe("u1");
      expect(s.pendingHighlightNote).toBe(true);
    });

    it("setPendingFocusUuid without highlightNote resets pendingHighlightNote to false", () => {
      // Seed a true flag first: omitting the arg must actively reset it, not
      // just leave the beforeEach default in place.
      useCardboxStore.getState().setPendingFocusUuid("u0", true);
      expect(useCardboxStore.getState().pendingHighlightNote).toBe(true);
      useCardboxStore.getState().setPendingFocusUuid("u1");
      expect(useCardboxStore.getState().pendingHighlightNote).toBe(false);
    });

    it("setPendingFocusUuid(null) resets pendingHighlightNote", () => {
      useCardboxStore.getState().setPendingFocusUuid("u1", true);
      useCardboxStore.getState().setPendingFocusUuid(null);
      const s = useCardboxStore.getState();
      expect(s.pendingFocusUuid).toBeNull();
      expect(s.pendingHighlightNote).toBe(false);
    });
  });

  describe("pendingNotePrefill (#968)", () => {
    it("initializes as null", () => {
      expect(useCardboxStore.getState().pendingNotePrefill).toBeNull();
    });

    it("setPendingNotePrefill stages a quote for a card", () => {
      useCardboxStore.getState().setPendingNotePrefill({ uuid: "u1", text: "> quoted" });
      expect(useCardboxStore.getState().pendingNotePrefill).toEqual({
        uuid: "u1",
        text: "> quoted",
      });
    });

    it("setPendingNotePrefill(null) clears the staged quote", () => {
      useCardboxStore.getState().setPendingNotePrefill({ uuid: "u1", text: "> quoted" });
      useCardboxStore.getState().setPendingNotePrefill(null);
      expect(useCardboxStore.getState().pendingNotePrefill).toBeNull();
    });
  });

  describe("loadLayout slip-note migration", () => {
    const MIGRATE_OK = {
      migrated: 3,
      failed: 0,
      skipped: 0,
      changed_pages: [],
      failures: [],
    };
    const LAYOUT = { version: 3, order: [], links: [], groups: {}, pinned: ["u1"] };

    beforeEach(() => {
      useStatusMessageStore.setState({ message: null, variant: "success", action: null });
    });

    it("awaits migrate_cardbox_slip_notes before read_cardbox_layout", async () => {
      const callLog: string[] = [];
      mockInvoke((cmd) => {
        callLog.push(cmd);
        if (cmd === "migrate_cardbox_slip_notes") return MIGRATE_OK;
        if (cmd === "read_cardbox_layout") return LAYOUT;
        return null;
      });
      await useCardboxStore.getState().loadLayout();
      expect(callLog).toEqual(["migrate_cardbox_slip_notes", "read_cardbox_layout"]);
    });

    it("surfaces a notice with the count when migration reports failures, and still reads the layout", async () => {
      const callLog: string[] = [];
      mockInvoke((cmd) => {
        callLog.push(cmd);
        if (cmd === "migrate_cardbox_slip_notes")
          return { ...MIGRATE_OK, failed: 2, failures: [{ uuid: "u8", reason: "x" }, { uuid: "u9", reason: "y" }] };
        if (cmd === "read_cardbox_layout") return LAYOUT;
        return null;
      });
      await useCardboxStore.getState().loadLayout();
      expect(useStatusMessageStore.getState().message).toBe(
        "2 notes could not be written to source; will retry next open",
      );
      expect(useStatusMessageStore.getState().variant).toBe("error");
      expect(callLog[callLog.length - 1]).toBe("read_cardbox_layout");
      expect(useCardboxStore.getState().pinned).toEqual(["u1"]);
    });

    it("logs per-note failure reasons to the console when migration reports failures", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const failures = [{ uuid: "u8", reason: "x" }, { uuid: "u9", reason: "y" }];
      mockInvoke((cmd) => {
        if (cmd === "migrate_cardbox_slip_notes")
          return { ...MIGRATE_OK, failed: 2, failures };
        if (cmd === "read_cardbox_layout") return LAYOUT;
        return null;
      });
      await useCardboxStore.getState().loadLayout();
      expect(warnSpy).toHaveBeenCalledWith(
        "[cardbox] slip-note migration failures:",
        failures,
      );
      warnSpy.mockRestore();
    });

    it("logs the error to the console when migration rejects", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const err = new Error("cardbox.json unreadable");
      mockInvoke((cmd) => {
        if (cmd === "migrate_cardbox_slip_notes") throw err;
        if (cmd === "read_cardbox_layout") return LAYOUT;
        return null;
      });
      await useCardboxStore.getState().loadLayout();
      expect(errorSpy).toHaveBeenCalledWith(
        "[cardbox] slip-note migration failed:",
        err,
      );
      errorSpy.mockRestore();
    });

    it("shows no notice when migration reports zero failures", async () => {
      mockInvoke((cmd) => {
        if (cmd === "migrate_cardbox_slip_notes") return MIGRATE_OK;
        if (cmd === "read_cardbox_layout") return LAYOUT;
        return null;
      });
      await useCardboxStore.getState().loadLayout();
      expect(useStatusMessageStore.getState().message).toBeNull();
    });

    it("a rejected migration shows an error toast and still reads the layout", async () => {
      mockInvoke((cmd) => {
        if (cmd === "migrate_cardbox_slip_notes") throw new Error("cardbox.json unreadable");
        if (cmd === "read_cardbox_layout") return LAYOUT;
        return null;
      });
      await useCardboxStore.getState().loadLayout();
      expect(useStatusMessageStore.getState().message).toBe(
        "Slip-note migration failed; will retry next open",
      );
      expect(useStatusMessageStore.getState().variant).toBe("error");
      expect(useCardboxStore.getState().pinned).toEqual(["u1"]);
    });

    // layoutLoaded gates pending-focus consumption in CardboxView: the NOTE
    // highlight needs the layout's notes in the store before the focus fires,
    // and the saved order must be applied before scroll positions are computed.
    it("layoutLoaded defaults to false", () => {
      expect(useCardboxStore.getState().layoutLoaded).toBe(false);
    });

    it("loadLayout sets layoutLoaded after a successful read", async () => {
      mockInvoke((cmd) => {
        if (cmd === "migrate_cardbox_slip_notes") return MIGRATE_OK;
        if (cmd === "read_cardbox_layout") return LAYOUT;
        return null;
      });
      await useCardboxStore.getState().loadLayout();
      expect(useCardboxStore.getState().layoutLoaded).toBe(true);
    });

    // The flag must settle even on failure, or a pending focus would hang
    // forever waiting for a layout that will never arrive (same philosophy as
    // the F3 clear for failed annotation fetches).
    it("loadLayout sets layoutLoaded even when read_cardbox_layout rejects", async () => {
      mockInvoke((cmd) => {
        if (cmd === "migrate_cardbox_slip_notes") return MIGRATE_OK;
        if (cmd === "read_cardbox_layout") throw new Error("layout unreadable");
        return null;
      });
      await useCardboxStore.getState().loadLayout();
      expect(useCardboxStore.getState().layoutLoaded).toBe(true);
    });

    it("loadLayout sets layoutLoaded even when migration rejects", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockInvoke((cmd) => {
        if (cmd === "migrate_cardbox_slip_notes") throw new Error("migrate failed");
        if (cmd === "read_cardbox_layout") return LAYOUT;
        return null;
      });
      await useCardboxStore.getState().loadLayout();
      expect(useCardboxStore.getState().layoutLoaded).toBe(true);
      errorSpy.mockRestore();
    });
  });

  describe("setNote / clearNote source sync", () => {
    const SYNC_OK = {
      parent_uuid: "u1",
      body: "body",
      updated_at: "2026-07-29T00:00:00Z",
      sn_uuid: "sn-1",
      synced: true,
      page_id: "a.md",
    };

    beforeEach(() => {
      useStatusMessageStore.setState({ message: null, variant: "success", action: null });
    });

    it("setNote passes the trimmed body to sync_slip_note_to_source", async () => {
      let syncedBody: unknown = null;
      mockInvoke((cmd, args) => {
        if (cmd === "sync_slip_note_to_source") {
          syncedBody = args?.body;
          return SYNC_OK;
        }
        return null;
      });
      await useCardboxStore.getState().setNote("u1", "  body  ");
      expect(syncedBody).toBe("body");
    });

    it("setNote resolves, retains the optimistic note, and shows an error when sync fails", async () => {
      mockInvoke((cmd) => {
        if (cmd === "sync_slip_note_to_source") throw new Error("page IO failed");
        return null;
      });
      await useCardboxStore.getState().setNote("u1", "typed note");
      expect(useCardboxStore.getState().notes["u1"]?.body).toBe("typed note");
      expect(useStatusMessageStore.getState().message).toBe("Failed to save note");
      expect(useStatusMessageStore.getState().variant).toBe("error");
    });

    it("setNote applies the optimistic note immediately, then aligns updated_at to the SyncResult", async () => {
      let resolveSync: (value: unknown) => void = () => {};
      mockInvoke((cmd) => {
        if (cmd === "sync_slip_note_to_source") {
          return new Promise((resolve) => { resolveSync = resolve; });
        }
        return null;
      });
      const setPromise = useCardboxStore.getState().setNote("u1", "body");
      const optimistic = useCardboxStore.getState().notes["u1"];
      expect(optimistic?.body).toBe("body");
      expect(optimistic?.updated_at).not.toBe(SYNC_OK.updated_at);
      resolveSync(SYNC_OK);
      await setPromise;
      expect(useCardboxStore.getState().notes["u1"]?.updated_at).toBe(SYNC_OK.updated_at);
    });

    it("a stale sync resolve does not overwrite a newer optimistic note", async () => {
      let resolveFirst: (value: unknown) => void = () => {};
      let firstCall = true;
      mockInvoke((cmd) => {
        if (cmd === "sync_slip_note_to_source") {
          if (firstCall) {
            firstCall = false;
            return new Promise((resolve) => { resolveFirst = resolve; });
          }
          return { ...SYNC_OK, body: "newer", updated_at: "2026-07-29T00:00:02Z" };
        }
        return null;
      });
      const first = useCardboxStore.getState().setNote("u1", "body");
      await useCardboxStore.getState().setNote("u1", "newer");
      resolveFirst(SYNC_OK);
      await first;
      const note = useCardboxStore.getState().notes["u1"];
      expect(note?.body).toBe("newer");
      expect(note?.updated_at).not.toBe(SYNC_OK.updated_at);
    });

    it("a stale resolve with a coincidentally equal body does not regress updated_at (A -> B -> A)", async () => {
      const T1 = "2026-07-29T00:00:01Z";
      const T3 = "2026-07-29T00:00:03Z";
      let resolveFirst: (value: unknown) => void = () => {};
      let call = 0;
      mockInvoke((cmd, args) => {
        if (cmd === "sync_slip_note_to_source") {
          call += 1;
          if (call === 1) {
            return new Promise((resolve) => { resolveFirst = resolve; });
          }
          if (call === 2) return { ...SYNC_OK, body: "B", updated_at: "2026-07-29T00:00:02Z" };
          return { ...SYNC_OK, body: args?.body, updated_at: T3 };
        }
        return null;
      });
      const first = useCardboxStore.getState().setNote("u1", "A");
      await useCardboxStore.getState().setNote("u1", "B");
      await useCardboxStore.getState().setNote("u1", "A");
      expect(useCardboxStore.getState().notes["u1"]?.updated_at).toBe(T3);
      // The first sync resolves late with the same body "A" but a stale timestamp.
      resolveFirst({ ...SYNC_OK, body: "A", updated_at: T1 });
      await first;
      const note = useCardboxStore.getState().notes["u1"];
      expect(note?.body).toBe("A");
      expect(note?.updated_at).toBe(T3);
    });

    it("a failed sync does not latch: the next setNote retries normally", async () => {
      const syncCalls: unknown[] = [];
      let failNext = true;
      mockInvoke((cmd, args) => {
        if (cmd === "sync_slip_note_to_source") {
          syncCalls.push(args?.body);
          if (failNext) throw new Error("page IO failed");
          return { ...SYNC_OK, body: "ab" };
        }
        return null;
      });
      await useCardboxStore.getState().setNote("u1", "a");
      expect(useStatusMessageStore.getState().message).toBe("Failed to save note");

      failNext = false;
      await useCardboxStore.getState().setNote("u1", "ab");
      expect(syncCalls).toEqual(["a", "ab"]);
      const note = useCardboxStore.getState().notes["u1"];
      expect(note?.body).toBe("ab");
      expect(note?.updated_at).toBe(SYNC_OK.updated_at);
    });

    it("loadLayout preserves a note whose sync is still in flight, then aligns on resolve", async () => {
      let resolveSync: (value: unknown) => void = () => {};
      mockInvoke((cmd) => {
        if (cmd === "sync_slip_note_to_source") {
          return new Promise((resolve) => { resolveSync = resolve; });
        }
        if (cmd === "migrate_cardbox_slip_notes")
          return { migrated: 0, failed: 0, skipped: 0, changed_pages: [], failures: [] };
        if (cmd === "read_cardbox_layout")
          return { version: 3, order: ["u1"], links: [], groups: {}, pinned: [], notes: {} };
        return null;
      });
      const setPromise = useCardboxStore.getState().setNote("u1", "typed");
      await useCardboxStore.getState().loadLayout();
      // The read layout has no note for u1, but the sync is still pending —
      // the optimistic body must survive the layout application.
      expect(useCardboxStore.getState().notes["u1"]?.body).toBe("typed");
      resolveSync({ ...SYNC_OK, body: "typed", updated_at: "2026-07-29T00:00:05Z" });
      await setPromise;
      const note = useCardboxStore.getState().notes["u1"];
      expect(note?.body).toBe("typed");
      expect(note?.updated_at).toBe("2026-07-29T00:00:05Z");
    });

    it("loadLayout preserves a pending clearNote deletion even when the read layout still has the note", async () => {
      useCardboxStore.setState({
        notes: { u1: { body: "old", updated_at: "2026-07-28T00:00:00Z" } },
      });
      let resolveSync: (value: unknown) => void = () => {};
      mockInvoke((cmd) => {
        if (cmd === "sync_slip_note_to_source") {
          return new Promise((resolve) => { resolveSync = resolve; });
        }
        if (cmd === "migrate_cardbox_slip_notes")
          return { migrated: 0, failed: 0, skipped: 0, changed_pages: [], failures: [] };
        if (cmd === "read_cardbox_layout")
          return {
            version: 3,
            order: ["u1"],
            links: [],
            groups: {},
            pinned: [],
            notes: { u1: { body: "old", updated_at: "2026-07-28T00:00:00Z" } },
          };
        return null;
      });
      const clearPromise = useCardboxStore.getState().clearNote("u1");
      await useCardboxStore.getState().loadLayout();
      expect(useCardboxStore.getState().notes["u1"]).toBeUndefined();
      resolveSync({ ...SYNC_OK, body: "", synced: false });
      await clearPromise;
      expect(useCardboxStore.getState().notes["u1"]).toBeUndefined();
    });

    it("saveLayout never transmits client notes (backend derives them from sn)", async () => {
      useCardboxStore.setState({
        notes: { u1: { body: "in-memory note", updated_at: "2026-07-29T00:00:00Z" } },
      });
      let sentNotes: unknown = null;
      mockInvoke((cmd, args) => {
        if (cmd === "write_cardbox_layout") {
          sentNotes = (args?.layout as { notes?: unknown })?.notes;
        }
        return null;
      });
      await useCardboxStore.getState().saveLayout();
      expect(sentNotes).toEqual({});
    });

    it("clearNote resolves, keeps the optimistic clear, and shows an error when sync fails", async () => {
      useCardboxStore.setState({
        notes: { u1: { body: "old", updated_at: "2026-07-28T00:00:00Z" } },
      });
      mockInvoke((cmd) => {
        if (cmd === "sync_slip_note_to_source") throw new Error("page IO failed");
        return null;
      });
      await useCardboxStore.getState().clearNote("u1");
      expect(useCardboxStore.getState().notes["u1"]).toBeUndefined();
      expect(useStatusMessageStore.getState().message).toBe("Failed to save note");
      expect(useStatusMessageStore.getState().variant).toBe("error");
    });
  });
});
