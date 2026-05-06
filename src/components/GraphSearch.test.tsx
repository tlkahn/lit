import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Graph from "graphology";
import { GraphSearch, getMatchingNodes, type GraphSearchProps } from "./GraphSearch";

function StatefulSearch(props: Omit<GraphSearchProps, "query" | "onQueryChange"> & { onQueryChange?: (q: string) => void }) {
  const [query, setQuery] = useState("");
  return (
    <GraphSearch
      {...props}
      query={query}
      onQueryChange={(q) => { setQuery(q); props.onQueryChange?.(q); }}
    />
  );
}

describe("GraphSearch", () => {
  const defaults = {
    visible: true,
    query: "",
    matchCount: 0,
    onQueryChange: vi.fn(),
    onNavigate: vi.fn(),
    onClose: vi.fn(),
  };

  it("renders nothing when visible=false", () => {
    const { container } = render(<GraphSearch {...defaults} visible={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders input with data-testid when visible", () => {
    render(<GraphSearch {...defaults} />);
    expect(screen.getByTestId("graph-search-input")).toBeTruthy();
  });

  it("auto-focuses input when visible becomes true", () => {
    const { rerender } = render(<GraphSearch {...defaults} visible={false} />);
    rerender(<GraphSearch {...defaults} visible={true} />);
    expect(document.activeElement).toBe(screen.getByTestId("graph-search-input"));
  });

  it("typing calls onQueryChange with accumulated value", async () => {
    const onQueryChange = vi.fn();
    render(<StatefulSearch visible matchCount={0} onNavigate={vi.fn()} onClose={vi.fn()} onQueryChange={onQueryChange} />);
    await userEvent.type(screen.getByTestId("graph-search-input"), "hello");
    expect(onQueryChange).toHaveBeenCalledWith("h");
    expect(onQueryChange).toHaveBeenCalledWith("he");
    expect(onQueryChange).toHaveBeenCalledWith("hel");
    expect(onQueryChange).toHaveBeenCalledWith("hell");
    expect(onQueryChange).toHaveBeenCalledWith("hello");
  });

  it("Escape with non-empty query clears query, does not close", async () => {
    const onQueryChange = vi.fn();
    const onClose = vi.fn();
    render(<GraphSearch {...defaults} query="test" onQueryChange={onQueryChange} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onQueryChange).toHaveBeenCalledWith("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape with empty query calls onClose", async () => {
    const onClose = vi.fn();
    render(<GraphSearch {...defaults} query="" onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter with matches calls onNavigate with firstMatchId", async () => {
    const onNavigate = vi.fn();
    render(<GraphSearch {...defaults} query="test" matchCount={3} onNavigate={onNavigate} firstMatchId="a.md" />);
    await userEvent.keyboard("{Enter}");
    expect(onNavigate).toHaveBeenCalledWith("a.md");
  });

  it("displays match count", () => {
    render(<GraphSearch {...defaults} query="test" matchCount={3} />);
    expect(screen.getByTestId("graph-search-count").textContent).toBe("3 matches");
  });
});

describe("getMatchingNodes", () => {
  it("returns matching node IDs by case-insensitive substring on label", () => {
    const g = new Graph();
    g.addNode("a.md", { label: "Alpha" });
    g.addNode("b.md", { label: "Beta" });
    g.addNode("c.md", { label: "alphabet" });

    expect(getMatchingNodes(g, "alph")).toEqual(["a.md", "c.md"]);
    expect(getMatchingNodes(g, "BETA")).toEqual(["b.md"]);
    expect(getMatchingNodes(g, "xyz")).toEqual([]);
  });

  it("returns empty array for empty query", () => {
    const g = new Graph();
    g.addNode("a.md", { label: "Alpha" });

    expect(getMatchingNodes(g, "")).toEqual([]);
  });
});
