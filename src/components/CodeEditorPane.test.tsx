import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { usePaneStore } from "../stores/panes";
import { useCursorInfoStore } from "../stores/cursorInfo";
import CodeEditorPane from "./CodeEditorPane";

const handleChange = vi.fn();
const useCodeFileContentSpy = vi.fn((_paneId: string, _pagePath: string | null) => ({
  body: "@article{key,",
  isDirty: false,
  handleChange,
  siblingUpdateRef: { current: false },
}));

vi.mock("../hooks/useCodeFileContent", () => ({
  useCodeFileContent: (paneId: string, pagePath: string | null) =>
    useCodeFileContentSpy(paneId, pagePath),
}));

const loadLanguageSpy = vi.fn((_filename: string) => Promise.resolve(null));
vi.mock("../editor/codeLanguages", () => ({
  loadLanguage: (filename: string) => loadLanguageSpy(filename),
}));

let capturedSelectionChange: ((line: number, col: number) => void) | undefined;
vi.mock("../editor/useCodeMirrorCode", () => ({
  useCodeMirrorCode: (props: { onSelectionChange?: (l: number, c: number) => void }) => {
    capturedSelectionChange = props.onSelectionChange;
    return { view: null };
  },
}));

vi.mock("../hooks/useKeymaps", () => ({
  useKeymaps: () => ({ editorBindings: [], loading: false }),
}));

function seedLeaf(pagePath: string | null): string {
  const id = "test-pane";
  usePaneStore.setState({
    root: { type: "leaf", id, pagePath },
    focusedPaneId: id,
  });
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedSelectionChange = undefined;
  useCursorInfoStore.setState({ line: 0, col: 0 });
});

describe("CodeEditorPane", () => {
  it("renders the stable empty-state testid when no path is selected", () => {
    const paneId = seedLeaf(null);
    const { getByTestId } = render(<CodeEditorPane paneId={paneId} />);
    expect(getByTestId(`code-editor-pane-${paneId}`)).toBeInTheDocument();
  });

  it("calls useCodeFileContent with (paneId, pagePath) and loadLanguage with the basename", async () => {
    const paneId = seedLeaf("a/b/refs.bib");
    render(<CodeEditorPane paneId={paneId} />);
    expect(useCodeFileContentSpy).toHaveBeenCalledWith(paneId, "a/b/refs.bib");
    await waitFor(() => {
      expect(loadLanguageSpy).toHaveBeenCalledWith("refs.bib");
    });
  });

  it("routes selection changes into the cursor info store", () => {
    const paneId = seedLeaf("refs.bib");
    render(<CodeEditorPane paneId={paneId} />);
    expect(capturedSelectionChange).toBeTypeOf("function");
    capturedSelectionChange!(12, 5);
    expect(useCursorInfoStore.getState()).toMatchObject({ line: 12, col: 5 });
  });

  it("is a default export renderable with a { paneId } prop (React.lazy contract)", () => {
    const paneId = seedLeaf(null);
    const { getByTestId } = render(<CodeEditorPane paneId={paneId} />);
    expect(getByTestId(`code-editor-pane-${paneId}`)).toBeInTheDocument();
  });

  it("focuses the pane on the focus event", () => {
    const paneId = seedLeaf("refs.bib");
    // Make the assertion meaningful: another pane currently holds focus.
    usePaneStore.setState({ focusedPaneId: "other-pane" });
    const { getByTestId } = render(<CodeEditorPane paneId={paneId} />);
    fireEvent.focus(getByTestId(`code-editor-pane-${paneId}`));
    expect(usePaneStore.getState().focusedPaneId).toBe(paneId);
  });
});
