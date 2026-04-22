import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { YamlHighlighter } from "./YamlHighlighter";

describe("YamlHighlighter", () => {
  it("renders YAML text content", () => {
    render(<YamlHighlighter code={"title: Hello\n"} data-testid="yaml" />);
    const el = screen.getByTestId("yaml");
    expect(el.textContent).toContain("title");
    expect(el.textContent).toContain("Hello");
  });

  it("produces span elements with tok-* classes for keys and strings", () => {
    const { container } = render(
      <YamlHighlighter code={'name: "world"\n'} data-testid="yaml" />,
    );
    const spans = container.querySelectorAll("span[class]");
    const classes = Array.from(spans).map((s) => s.className);
    expect(classes.some((c) => c.includes("tok-"))).toBe(true);
  });

  it("passes through className", () => {
    render(
      <YamlHighlighter code="a: 1\n" className="my-class" data-testid="yaml" />,
    );
    expect(screen.getByTestId("yaml").className).toContain("my-class");
  });

  it("handles empty string", () => {
    render(<YamlHighlighter code="" data-testid="yaml" />);
    expect(screen.getByTestId("yaml").textContent).toBe("");
  });

  it("forwards onClick to pre element", async () => {
    const handleClick = vi.fn();
    render(
      <YamlHighlighter code="a: 1\n" data-testid="yaml" onClick={handleClick} />,
    );
    await userEvent.click(screen.getByTestId("yaml"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
