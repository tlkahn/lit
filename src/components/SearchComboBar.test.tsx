import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchComboBar } from "./SearchComboBar";

function renderBar(overrides: Partial<Parameters<typeof SearchComboBar>[0]> = {}) {
  const props = {
    query: "",
    onQueryChange: vi.fn(),
    mode: "auto",
    onModeChange: vi.fn(),
    onSearch: vi.fn(),
    searching: false,
    ...overrides,
  };
  render(<SearchComboBar {...props} />);
  return props;
}

describe("SearchComboBar", () => {
  it("renders mode chip, input, and search button", () => {
    renderBar();
    expect(screen.getByLabelText("Search mode")).toBeInTheDocument();
    expect(screen.getByLabelText("Search academic papers")).toBeInTheDocument();
    expect(screen.getByTestId("search-papers-btn")).toBeInTheDocument();
  });

  it("shows current mode label on chip", () => {
    renderBar({ mode: "doi" });
    expect(screen.getByLabelText("Search mode").textContent).toContain("DOI");
  });

  it("clicking mode chip opens dropdown", async () => {
    const user = userEvent.setup();
    renderBar();
    expect(screen.queryByTestId("search-mode-dropdown")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Search mode"));
    expect(screen.getByTestId("search-mode-dropdown")).toBeInTheDocument();
  });

  it("selecting a mode updates and closes dropdown", async () => {
    const user = userEvent.setup();
    const props = renderBar();
    await user.click(screen.getByLabelText("Search mode"));
    const dropdown = screen.getByTestId("search-mode-dropdown");
    await user.click(within(dropdown).getByText("ISBN"));
    expect(props.onModeChange).toHaveBeenCalledWith("isbn");
    expect(screen.queryByTestId("search-mode-dropdown")).not.toBeInTheDocument();
  });

  it("Escape closes the dropdown", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByLabelText("Search mode"));
    expect(screen.getByTestId("search-mode-dropdown")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("search-mode-dropdown")).not.toBeInTheDocument();
  });

  it("Enter in input triggers onSearch", async () => {
    const user = userEvent.setup();
    const props = renderBar({ query: "test query" });
    const input = screen.getByLabelText("Search academic papers");
    await user.click(input);
    await user.keyboard("{Enter}");
    expect(props.onSearch).toHaveBeenCalled();
  });

  it("Enter in input does not trigger onSearch when disabled", async () => {
    const user = userEvent.setup();
    const props = renderBar({ query: "" });
    const input = screen.getByLabelText("Search academic papers");
    await user.click(input);
    await user.keyboard("{Enter}");
    expect(props.onSearch).not.toHaveBeenCalled();
  });

  it("search button is disabled when query is empty", () => {
    renderBar({ query: "" });
    expect(screen.getByTestId("search-papers-btn")).toBeDisabled();
  });

  it("search button is disabled when searching", () => {
    renderBar({ query: "test", searching: true });
    expect(screen.getByTestId("search-papers-btn")).toBeDisabled();
  });

  it("shows '...' on search button when searching", () => {
    renderBar({ query: "test", searching: true });
    expect(screen.getByTestId("search-papers-btn").textContent).toBe("...");
  });

  it("mode chip has accent color when mode is not auto", () => {
    renderBar({ mode: "author" });
    const chip = screen.getByLabelText("Search mode");
    expect(chip.className).toContain("text-interactive-accent");
  });

  it("trigger has aria-haspopup='listbox'", () => {
    renderBar();
    expect(screen.getByLabelText("Search mode")).toHaveAttribute("aria-haspopup", "listbox");
  });

  it("trigger has aria-expanded false when closed, true when open", async () => {
    const user = userEvent.setup();
    renderBar();
    const chip = screen.getByLabelText("Search mode");
    expect(chip).toHaveAttribute("aria-expanded", "false");
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
  });

  it("dropdown has role='listbox'", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByLabelText("Search mode"));
    expect(screen.getByTestId("search-mode-dropdown")).toHaveAttribute("role", "listbox");
  });

  it("all option buttons have role='option'", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByLabelText("Search mode"));
    const options = within(screen.getByTestId("search-mode-dropdown")).getAllByRole("option");
    expect(options).toHaveLength(6);
  });

  it("active option has aria-selected='true'", async () => {
    const user = userEvent.setup();
    renderBar({ mode: "doi" });
    await user.click(screen.getByLabelText("Search mode"));
    const doiOption = within(screen.getByTestId("search-mode-dropdown")).getByText("DOI");
    expect(doiOption).toHaveAttribute("aria-selected", "true");
    const autoOption = within(screen.getByTestId("search-mode-dropdown")).getByText("Auto");
    expect(autoOption).toHaveAttribute("aria-selected", "false");
  });

  it("ArrowDown moves focus to next option", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByLabelText("Search mode"));
    const dropdown = screen.getByTestId("search-mode-dropdown");
    fireEvent.keyDown(dropdown, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Auto");
    fireEvent.keyDown(dropdown, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Keywords");
  });

  it("ArrowUp wraps from first to last option", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByLabelText("Search mode"));
    const dropdown = screen.getByTestId("search-mode-dropdown");
    fireEvent.keyDown(dropdown, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Auto");
    fireEvent.keyDown(dropdown, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("Title");
  });
});
