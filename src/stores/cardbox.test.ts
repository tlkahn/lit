import { describe, it, expect, beforeEach } from "vitest";
import { useCardboxStore } from "./cardbox";
import { mockInvoke } from "../test/tauri-mock";
import type { CardboxAnnotation } from "../lib/ipc";

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
      activeTypes: new Set<string>(),
    });
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return MOCK_ANNOTATIONS;
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
    expect(useCardboxStore.getState().activeTypes).toEqual(new Set(["question"]));
  });

  it("toggleType adds a type back to activeTypes", () => {
    useCardboxStore.setState({ activeTypes: new Set(["question"]) });
    useCardboxStore.getState().toggleType("note");
    expect(useCardboxStore.getState().activeTypes).toEqual(new Set(["question", "note"]));
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
    expect(useCardboxStore.getState().activeTypes).toEqual(new Set(["question"]));
  });
});
