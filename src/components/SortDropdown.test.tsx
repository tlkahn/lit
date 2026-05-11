import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortDropdown } from "./SortDropdown";
import type { SortConfig, SortKey } from "../lib/pageSort";

function renderDropdown(
  config: SortConfig = { key: "title", direction: "asc" },
  onSelectKey: (k: SortKey) => void = () => {},
) {
  return render(<SortDropdown sortConfig={config} onSelectKey={onSelectKey} />);
}

describe("SortDropdown", () => {
  it('renders a button with aria-label "Sort files"', () => {
    renderDropdown();
    expect(screen.getByRole("button", { name: "Sort files" })).toBeInTheDocument();
  });

  it("clicking opens dropdown with three options", async () => {
    const user = userEvent.setup();
    renderDropdown();
    await user.click(screen.getByRole("button", { name: "Sort files" }));
    expect(screen.getByText("File name")).toBeInTheDocument();
    expect(screen.getByText("Modified time")).toBeInTheDocument();
    expect(screen.getByText("Created time")).toBeInTheDocument();
  });

  it("active sort key row has the accent class", async () => {
    const user = userEvent.setup();
    renderDropdown({ key: "modified_at", direction: "desc" });
    await user.click(screen.getByRole("button", { name: "Sort files" }));
    const active = screen.getByText("Modified time").closest("button")!;
    expect(active.className).toContain("text-interactive-accent");
  });

  it("shows ↑ for asc direction on active key", async () => {
    const user = userEvent.setup();
    renderDropdown({ key: "title", direction: "asc" });
    await user.click(screen.getByRole("button", { name: "Sort files" }));
    const titleBtn = screen.getByText("File name").closest("button")!;
    expect(titleBtn.textContent).toContain("↑");
  });

  it("shows ↓ for desc direction on active key", async () => {
    const user = userEvent.setup();
    renderDropdown({ key: "title", direction: "desc" });
    await user.click(screen.getByRole("button", { name: "Sort files" }));
    const titleBtn = screen.getByText("File name").closest("button")!;
    expect(titleBtn.textContent).toContain("↓");
  });

  it("clicking an option calls onSelectKey and closes dropdown", async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    renderDropdown({ key: "title", direction: "asc" }, spy);
    await user.click(screen.getByRole("button", { name: "Sort files" }));
    await user.click(screen.getByText("Modified time"));
    expect(spy).toHaveBeenCalledWith("modified_at");
    expect(screen.queryByText("File name")).not.toBeInTheDocument();
  });

  it("Escape closes dropdown", async () => {
    const user = userEvent.setup();
    renderDropdown();
    await user.click(screen.getByRole("button", { name: "Sort files" }));
    expect(screen.getByText("File name")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("File name")).not.toBeInTheDocument();
  });

  it("click outside closes dropdown", async () => {
    const user = userEvent.setup();
    renderDropdown();
    await user.click(screen.getByRole("button", { name: "Sort files" }));
    expect(screen.getByText("File name")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("File name")).not.toBeInTheDocument();
  });

  it("sort icon has accent when non-default sort is active", () => {
    const { rerender } = render(
      <SortDropdown sortConfig={{ key: "title", direction: "asc" }} onSelectKey={() => {}} />,
    );
    const defaultBtn = screen.getByRole("button", { name: "Sort files" });
    expect(defaultBtn.className).not.toContain("text-interactive-accent");

    rerender(
      <SortDropdown sortConfig={{ key: "modified_at", direction: "desc" }} onSelectKey={() => {}} />,
    );
    const nonDefaultBtn = screen.getByRole("button", { name: "Sort files" });
    expect(nonDefaultBtn.className).toContain("text-interactive-accent");
  });
});
