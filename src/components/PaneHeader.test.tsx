import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePaneStore } from "../stores/panes";
import { usePaneHistoryStore } from "../stores/paneHistory";
import { useWorkspaceStore } from "../stores/workspace";
import { registerPaneContent, _resetForTesting as resetRegistry } from "../lib/paneContentRegistry";
import type { PageMeta } from "../lib/ipc";

vi.mock("./EditorPane", () => ({
  EditorPane: ({ paneId }: { paneId: string }) => (
    <div data-testid={`editor-pane-${paneId}`} />
  ),
}));
vi.mock("./PdfViewerPane", () => ({
  PdfViewerPane: ({ paneId }: { paneId: string }) => (
    <div data-testid={`pdf-viewer-pane-${paneId}`} />
  ),
}));
vi.mock("./CodeEditorPane", () => ({
  default: ({ paneId }: { paneId: string }) => (
    <div data-testid={`code-editor-pane-${paneId}`} />
  ),
}));

import { PaneHeader } from "./PaneHeader";

function meta(
  relative_path: string,
  file_type: "markdown" | "pdf" | "code",
): PageMeta {
  return {
    title: relative_path.replace(/\.[^.]+$/, ""),
    relative_path,
    frontmatter: {},
    created_at: null,
    modified_at: null,
    file_type,
    has_companion: false,
  };
}

beforeEach(() => {
  usePaneStore.setState({
    root: { type: "leaf", id: "p1", pagePath: null },
    focusedPaneId: "p1",
  });
  usePaneHistoryStore.setState({ stacks: new Map() });
  useWorkspaceStore.setState({ pages: [] });
  resetRegistry();
  return cleanup;
});

describe("PaneHeader", () => {
  it("returns null when pagePath is null (empty pane)", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: null },
      focusedPaneId: "p1",
    });
    const { container } = render(
      <PaneHeader paneId="p1" pagePath={null} fileType={null} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders back and forward buttons", () => {
    useWorkspaceStore.setState({ pages: [meta("note.md", "markdown")] });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "note.md" },
      focusedPaneId: "p1",
    });
    render(<PaneHeader paneId="p1" pagePath="note.md" fileType="markdown" />);
    expect(screen.getByTestId("pane-header")).toBeInTheDocument();
    expect(screen.getByTestId("pane-history-back")).toBeInTheDocument();
    expect(screen.getByTestId("pane-history-forward")).toBeInTheDocument();
  });

  it("disables both buttons when no history", () => {
    useWorkspaceStore.setState({ pages: [meta("note.md", "markdown")] });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "note.md" },
      focusedPaneId: "p1",
    });
    render(<PaneHeader paneId="p1" pagePath="note.md" fileType="markdown" />);
    expect(screen.getByTestId("pane-history-back")).toBeDisabled();
    expect(screen.getByTestId("pane-history-forward")).toBeDisabled();
  });

  it("enables back button when history has previous entries", () => {
    useWorkspaceStore.setState({
      pages: [meta("a.md", "markdown"), meta("b.md", "markdown")],
    });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "b.md" },
      focusedPaneId: "p1",
    });
    usePaneHistoryStore.setState({
      stacks: new Map([["p1", { entries: ["a.md", "b.md"], index: 1 }]]),
    });
    render(<PaneHeader paneId="p1" pagePath="b.md" fileType="markdown" />);
    expect(screen.getByTestId("pane-history-back")).not.toBeDisabled();
    expect(screen.getByTestId("pane-history-forward")).toBeDisabled();
  });

  it("calls goBack when back button is clicked", async () => {
    const goBackSpy = vi.fn(() => null);
    useWorkspaceStore.setState({
      pages: [meta("a.md", "markdown"), meta("b.md", "markdown")],
    });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "b.md" },
      focusedPaneId: "p1",
    });
    usePaneHistoryStore.setState({
      stacks: new Map([["p1", { entries: ["a.md", "b.md"], index: 1 }]]),
    });
    const originalGoBack = usePaneHistoryStore.getState().goBack;
    usePaneHistoryStore.setState({ goBack: goBackSpy });
    render(<PaneHeader paneId="p1" pagePath="b.md" fileType="markdown" />);

    await userEvent.click(screen.getByTestId("pane-history-back"));
    expect(goBackSpy).toHaveBeenCalledWith("p1");

    usePaneHistoryStore.setState({ goBack: originalGoBack });
  });

  it("calls goForward when forward button is clicked", async () => {
    const goForwardSpy = vi.fn(() => null);
    useWorkspaceStore.setState({
      pages: [meta("a.md", "markdown"), meta("b.md", "markdown")],
    });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "a.md" },
      focusedPaneId: "p1",
    });
    usePaneHistoryStore.setState({
      stacks: new Map([["p1", { entries: ["a.md", "b.md"], index: 0 }]]),
    });
    const originalGoForward = usePaneHistoryStore.getState().goForward;
    usePaneHistoryStore.setState({ goForward: goForwardSpy });
    render(<PaneHeader paneId="p1" pagePath="a.md" fileType="markdown" />);

    await userEvent.click(screen.getByTestId("pane-history-forward"));
    expect(goForwardSpy).toHaveBeenCalledWith("p1");

    usePaneHistoryStore.setState({ goForward: originalGoForward });
  });

  it("shows markdown title from paneContentRegistry", () => {
    useWorkspaceStore.setState({ pages: [meta("note.md", "markdown")] });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "note.md" },
      focusedPaneId: "p1",
    });
    registerPaneContent("p1", {
      title: "My Note",
      body: "",
      frontmatter: {},
    });
    render(<PaneHeader paneId="p1" pagePath="note.md" fileType="markdown" />);
    expect(screen.getByTestId("pane-header-title").textContent).toBe("My Note");
  });

  it("shows basename for PDF files", () => {
    useWorkspaceStore.setState({ pages: [meta("papers/doc.pdf", "pdf")] });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "papers/doc.pdf" },
      focusedPaneId: "p1",
    });
    render(
      <PaneHeader paneId="p1" pagePath="papers/doc.pdf" fileType="pdf" />,
    );
    expect(screen.getByTestId("pane-header-title").textContent).toBe("doc.pdf");
  });

  it("shows basename for code files", () => {
    useWorkspaceStore.setState({ pages: [meta("src/main.rs", "code")] });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "src/main.rs" },
      focusedPaneId: "p1",
    });
    render(<PaneHeader paneId="p1" pagePath="src/main.rs" fileType="code" />);
    expect(screen.getByTestId("pane-header-title").textContent).toBe("main.rs");
  });

  it("uses fileType and pagePath from props, not internal store lookups", () => {
    // Store has NO leaf for p1 and no pages, but we pass props directly.
    // If PaneHeader tried to read from the store, pagePath would be null and
    // it would render nothing. This proves it uses the prop values.
    usePaneStore.setState({
      root: { type: "leaf", id: "other", pagePath: null },
      focusedPaneId: "other",
    });
    useWorkspaceStore.setState({ pages: [] });
    render(
      <PaneHeader paneId="p1" pagePath="prop-note.md" fileType="markdown" />,
    );
    expect(screen.getByTestId("pane-header")).toBeInTheDocument();
    expect(screen.getByTestId("pane-header-title").textContent).toBe(
      "prop-note.md",
    );
  });

  it("falls back to basename when markdown pane has no registered title", () => {
    useWorkspaceStore.setState({ pages: [meta("note.md", "markdown")] });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "note.md" },
      focusedPaneId: "p1",
    });
    render(
      <PaneHeader paneId="p1" pagePath="note.md" fileType="markdown" />,
    );
    expect(screen.getByTestId("pane-header-title").textContent).toBe("note.md");
  });

  it("calls onMouseDown prop when header div receives mouseDown", () => {
    useWorkspaceStore.setState({ pages: [meta("note.md", "markdown")] });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "note.md" },
      focusedPaneId: "p1",
    });
    const onMouseDownSpy = vi.fn();
    render(
      <PaneHeader paneId="p1" pagePath="note.md" fileType="markdown" onMouseDown={onMouseDownSpy} />,
    );
    fireEvent.mouseDown(screen.getByTestId("pane-header"));
    expect(onMouseDownSpy).toHaveBeenCalledTimes(1);
  });
});
