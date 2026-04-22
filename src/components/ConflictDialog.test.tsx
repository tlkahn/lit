import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConflictDialog } from "./ConflictDialog";

describe("ConflictDialog", () => {
  it("renders nothing when open=false", () => {
    render(<ConflictDialog open={false} onKeepMine={vi.fn()} onReload={vi.fn()} />);
    expect(screen.queryByTestId("conflict-dialog")).not.toBeInTheDocument();
  });

  it("renders modal with message when open=true", () => {
    render(<ConflictDialog open={true} onKeepMine={vi.fn()} onReload={vi.fn()} />);
    expect(screen.getByTestId("conflict-dialog")).toBeInTheDocument();
    expect(screen.getByText(/modified externally/)).toBeInTheDocument();
  });

  it("calls onKeepMine on button click", () => {
    const onKeepMine = vi.fn();
    render(<ConflictDialog open={true} onKeepMine={onKeepMine} onReload={vi.fn()} />);
    screen.getByTestId("conflict-keep-mine").click();
    expect(onKeepMine).toHaveBeenCalledOnce();
  });

  it("calls onReload on button click", () => {
    const onReload = vi.fn();
    render(<ConflictDialog open={true} onKeepMine={vi.fn()} onReload={onReload} />);
    screen.getByTestId("conflict-reload").click();
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("Escape key calls onKeepMine", () => {
    const onKeepMine = vi.fn();
    render(<ConflictDialog open={true} onKeepMine={onKeepMine} onReload={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onKeepMine).toHaveBeenCalledOnce();
  });
});
