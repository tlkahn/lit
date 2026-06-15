import { describe, it, expect, beforeEach, vi } from "vitest";
import { useCardboxStore } from "./cardbox";
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
      order: [],
      links: [],
      groups: {},
    });
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return MOCK_ANNOTATIONS;
      if (cmd === "read_cardbox_layout")
        return { version: 2, order: ["u1", "u2"], links: [["u1", "u2"]], groups: {} };
      if (cmd === "write_cardbox_layout") return null;
      if (cmd === "add_cardbox_link") return null;
      if (cmd === "remove_cardbox_link") return null;
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

  it("saveLayout includes links", async () => {
    const invokeSpy = vi.fn().mockResolvedValue(null);
    mockInvoke((cmd, args) => {
      invokeSpy(cmd, args);
      return null;
    });
    useCardboxStore.setState({
      order: ["u1", "u2"],
      links: [["u1", "u2"]],
    });
    await useCardboxStore.getState().saveLayout();
    expect(invokeSpy).toHaveBeenCalledWith("write_cardbox_layout", {
      layout: { version: 2, order: ["u1", "u2"], links: [["u1", "u2"]], groups: {} },
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
      layout: { version: 3, order: ["group:g1", "u2"], links: [], groups },
    });
  });

  it("saveLayout uses version 2 when groups is empty", async () => {
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
      layout: { version: 2, order: ["u1", "u2"], links: [], groups: {} },
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
});
