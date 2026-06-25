import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    await user.click(dropdown.querySelector("button:nth-child(3)")!);
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

  it("hidden select is present with all options", () => {
    renderBar();
    const select = screen.getByTestId("search-mode-select") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["auto", "keywords", "isbn", "doi", "author", "title"]);
  });
});
