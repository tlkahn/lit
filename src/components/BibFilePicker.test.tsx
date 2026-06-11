import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { BibFilePicker } from "./BibFilePicker";

describe("BibFilePicker", () => {
  it("renders select with options when bibFiles non-empty", () => {
    const { container } = render(
      <BibFilePicker
        bibFiles={["/ws/refs.bib"]}
        selectedBibFile="/ws/refs.bib"
        onSelectedBibFileChange={vi.fn()}
        newBibPath="refs.bib"
        onNewBibPathChange={vi.fn()}
        testIdPrefix="test"
      />,
    );

    const select = container.querySelector("[data-testid='test-bib-select']") as HTMLSelectElement;
    expect(select).toBeTruthy();
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("/ws/refs.bib");
    expect(options).toContain("__new__");
  });

  it("renders hidden select when bibFiles empty", () => {
    const { container } = render(
      <BibFilePicker
        bibFiles={[]}
        selectedBibFile="__new__"
        onSelectedBibFileChange={vi.fn()}
        newBibPath="refs.bib"
        onNewBibPathChange={vi.fn()}
        testIdPrefix="test"
      />,
    );

    const select = container.querySelector("[data-testid='test-bib-select']") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.className).toContain("hidden");
  });

  it("shows new-bib input when selectedBibFile is __new__", () => {
    const { container } = render(
      <BibFilePicker
        bibFiles={["/ws/refs.bib"]}
        selectedBibFile="__new__"
        onSelectedBibFileChange={vi.fn()}
        newBibPath="refs.bib"
        onNewBibPathChange={vi.fn()}
        testIdPrefix="test"
      />,
    );

    const input = container.querySelector("[data-testid='test-bib-new-input']") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("refs.bib");
  });

  it("calls onSelectedBibFileChange on select change", () => {
    const onChange = vi.fn();
    const { container } = render(
      <BibFilePicker
        bibFiles={["/ws/refs.bib", "/ws/other.bib"]}
        selectedBibFile="/ws/refs.bib"
        onSelectedBibFileChange={onChange}
        newBibPath="refs.bib"
        onNewBibPathChange={vi.fn()}
        testIdPrefix="test"
      />,
    );

    const select = container.querySelector("[data-testid='test-bib-select']") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "/ws/other.bib" } });
    expect(onChange).toHaveBeenCalledWith("/ws/other.bib");
  });

  it("calls onNewBibPathChange on input change", () => {
    const onChange = vi.fn();
    const { container } = render(
      <BibFilePicker
        bibFiles={[]}
        selectedBibFile="__new__"
        onSelectedBibFileChange={vi.fn()}
        newBibPath="refs.bib"
        onNewBibPathChange={onChange}
        testIdPrefix="test"
      />,
    );

    const input = container.querySelector("[data-testid='test-bib-new-input']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "custom.bib" } });
    expect(onChange).toHaveBeenCalledWith("custom.bib");
  });

  it("uses testIdPrefix in all data-testid attributes", () => {
    const { container } = render(
      <BibFilePicker
        bibFiles={["/ws/refs.bib"]}
        selectedBibFile="__new__"
        onSelectedBibFileChange={vi.fn()}
        newBibPath="refs.bib"
        onNewBibPathChange={vi.fn()}
        testIdPrefix="foo"
      />,
    );

    expect(container.querySelector("[data-testid='foo-bib-select']")).toBeTruthy();
    expect(container.querySelector("[data-testid='foo-bib-new-input']")).toBeTruthy();
  });
});
