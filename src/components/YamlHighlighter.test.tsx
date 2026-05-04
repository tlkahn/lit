import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { YamlHighlighter, isHttpUrl, splitTokenByUrls } from "./YamlHighlighter";

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

describe("isHttpUrl", () => {
  it("returns true for https:// URLs", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("https://example.com/path?q=1")).toBe(true);
  });

  it("returns true for http:// URLs", () => {
    expect(isHttpUrl("http://example.com")).toBe(true);
  });

  it("returns false for non-URL strings", () => {
    expect(isHttpUrl("ftp://example.com")).toBe(false);
    expect(isHttpUrl("Hello world")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl("example.com")).toBe(false);
  });
});

describe("splitTokenByUrls", () => {
  it("returns single segment for plain text", () => {
    expect(splitTokenByUrls(" Hello")).toEqual([
      { text: " Hello", isUrl: false },
    ]);
  });

  it("extracts URL from unquoted YAML value", () => {
    expect(splitTokenByUrls(" https://example.com")).toEqual([
      { text: " ", isUrl: false },
      { text: "https://example.com", isUrl: true },
    ]);
  });

  it("extracts URL from quoted YAML value", () => {
    expect(splitTokenByUrls('"https://example.com"')).toEqual([
      { text: '"', isUrl: false },
      { text: "https://example.com", isUrl: true },
      { text: '"', isUrl: false },
    ]);
  });

  it("handles multiple URLs in one token", () => {
    const result = splitTokenByUrls(
      " https://a.com and https://b.com",
    );
    expect(result).toEqual([
      { text: " ", isUrl: false },
      { text: "https://a.com", isUrl: true },
      { text: " and ", isUrl: false },
      { text: "https://b.com", isUrl: true },
    ]);
  });
});

describe("YamlHighlighter URL rendering", () => {
  it("renders URL as an anchor element", () => {
    const { container } = render(
      <YamlHighlighter code="url: https://example.com\n" data-testid="yaml" />,
    );
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://example.com");
    expect(link!.textContent).toBe("https://example.com");
  });

  it("does not produce anchor elements for non-URL values", () => {
    const { container } = render(
      <YamlHighlighter code="title: Hello World\n" data-testid="yaml" />,
    );
    expect(container.querySelector("a")).toBeNull();
  });

  it("URL link has yaml-url class", () => {
    const { container } = render(
      <YamlHighlighter code="url: https://example.com\n" data-testid="yaml" />,
    );
    const link = container.querySelector("a");
    expect(link!.className).toContain("yaml-url");
  });

  it("clicking URL calls openUrl with correct URL", async () => {
    const { container } = render(
      <YamlHighlighter code="url: https://example.com\n" data-testid="yaml" />,
    );
    const link = container.querySelector("a")!;
    await userEvent.click(link);
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
  });

  it("clicking URL does not trigger parent onClick", async () => {
    const handleClick = vi.fn();
    const { container } = render(
      <YamlHighlighter
        code="url: https://example.com\n"
        data-testid="yaml"
        onClick={handleClick}
      />,
    );
    const link = container.querySelector("a")!;
    await userEvent.click(link);
    expect(handleClick).not.toHaveBeenCalled();
  });
});
