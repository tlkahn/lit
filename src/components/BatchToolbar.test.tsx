import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BatchToolbar } from "./BatchToolbar";
import { CARDBOX_COLORS } from "../lib/ipc";

const defaultProps = {
  selectedCount: 3,
  onMergeToDraft: vi.fn(),
  onGroup: vi.fn(),
  onLinkAll: vi.fn(),
  onSetColor: vi.fn(),
  onClearColor: vi.fn(),
  onPin: vi.fn(),
  onUnpin: vi.fn(),
  onClear: vi.fn(),
};

describe("BatchToolbar", () => {
  it("does not render when selectedCount < 2", () => {
    const { container } = render(
      <BatchToolbar {...defaultProps} selectedCount={1} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders when selectedCount >= 2", () => {
    render(<BatchToolbar {...defaultProps} selectedCount={2} />);
    expect(screen.getByTestId("batch-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("batch-count")).toHaveTextContent("2 selected");
  });

  it("shows correct selected count", () => {
    render(<BatchToolbar {...defaultProps} selectedCount={5} />);
    expect(screen.getByTestId("batch-count")).toHaveTextContent("5 selected");
  });

  it("calls onMergeToDraft when Merge to Draft button clicked", () => {
    const onMergeToDraft = vi.fn();
    render(<BatchToolbar {...defaultProps} onMergeToDraft={onMergeToDraft} />);
    fireEvent.click(screen.getByTestId("batch-merge-to-draft"));
    expect(onMergeToDraft).toHaveBeenCalledOnce();
  });

  it("calls onGroup when Group button clicked", () => {
    const onGroup = vi.fn();
    render(<BatchToolbar {...defaultProps} onGroup={onGroup} />);
    fireEvent.click(screen.getByTestId("batch-group"));
    expect(onGroup).toHaveBeenCalledOnce();
  });

  it("calls onLinkAll when Link All button clicked", () => {
    const onLinkAll = vi.fn();
    render(<BatchToolbar {...defaultProps} onLinkAll={onLinkAll} />);
    fireEvent.click(screen.getByTestId("batch-link-all"));
    expect(onLinkAll).toHaveBeenCalledOnce();
  });

  it("opens color popover on Color click", () => {
    render(<BatchToolbar {...defaultProps} />);
    expect(screen.queryByTestId("batch-color-popover")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("batch-color"));
    expect(screen.getByTestId("batch-color-popover")).toBeInTheDocument();
  });

  it("calls onSetColor with correct color from popover", () => {
    const onSetColor = vi.fn();
    render(<BatchToolbar {...defaultProps} onSetColor={onSetColor} />);
    fireEvent.click(screen.getByTestId("batch-color"));
    fireEvent.click(screen.getByTestId("batch-color-blue"));
    expect(onSetColor).toHaveBeenCalledWith("blue");
  });

  it("calls onClearColor from popover None button", () => {
    const onClearColor = vi.fn();
    render(<BatchToolbar {...defaultProps} onClearColor={onClearColor} />);
    fireEvent.click(screen.getByTestId("batch-color"));
    fireEvent.click(screen.getByTestId("batch-color-none"));
    expect(onClearColor).toHaveBeenCalledOnce();
  });

  it("calls onPin and onUnpin", () => {
    const onPin = vi.fn();
    const onUnpin = vi.fn();
    render(<BatchToolbar {...defaultProps} onPin={onPin} onUnpin={onUnpin} />);
    fireEvent.click(screen.getByTestId("batch-pin"));
    expect(onPin).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("batch-unpin"));
    expect(onUnpin).toHaveBeenCalledOnce();
  });

  it("calls onClear when Clear button clicked", () => {
    const onClear = vi.fn();
    render(<BatchToolbar {...defaultProps} onClear={onClear} />);
    fireEvent.click(screen.getByTestId("batch-clear"));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("renders all 6 color swatches in popover", () => {
    render(<BatchToolbar {...defaultProps} />);
    fireEvent.click(screen.getByTestId("batch-color"));
    for (const color of CARDBOX_COLORS) {
      expect(screen.getByTestId(`batch-color-${color}`)).toBeInTheDocument();
    }
  });

  it("disables Merge to Draft button when mergingToDraft is true", () => {
    render(<BatchToolbar {...defaultProps} mergingToDraft={true} />);
    const btn = screen.getByTestId("batch-merge-to-draft");
    expect(btn).toBeDisabled();
  });

  it("does not disable Merge to Draft button when mergingToDraft is false", () => {
    render(<BatchToolbar {...defaultProps} mergingToDraft={false} />);
    const btn = screen.getByTestId("batch-merge-to-draft");
    expect(btn).not.toBeDisabled();
  });

  it("does not call onMergeToDraft when button is disabled", () => {
    const onMergeToDraft = vi.fn();
    render(<BatchToolbar {...defaultProps} onMergeToDraft={onMergeToDraft} mergingToDraft={true} />);
    fireEvent.click(screen.getByTestId("batch-merge-to-draft"));
    expect(onMergeToDraft).not.toHaveBeenCalled();
  });

  describe("add to group (#968)", () => {
    it("calls onAddToGroup when the Add to Group button is clicked", () => {
      const onAddToGroup = vi.fn();
      render(<BatchToolbar {...defaultProps} hasGroups={true} onAddToGroup={onAddToGroup} />);
      fireEvent.click(screen.getByTestId("batch-add-to-group"));
      expect(onAddToGroup).toHaveBeenCalledOnce();
    });

    it("hides the Add to Group button when there are no groups", () => {
      render(<BatchToolbar {...defaultProps} hasGroups={false} onAddToGroup={vi.fn()} />);
      expect(screen.queryByTestId("batch-add-to-group")).not.toBeInTheDocument();
    });

    it("shows the Add to Group button when groups exist", () => {
      render(<BatchToolbar {...defaultProps} hasGroups={true} onAddToGroup={vi.fn()} />);
      expect(screen.getByTestId("batch-add-to-group")).toBeInTheDocument();
    });
  });
});
