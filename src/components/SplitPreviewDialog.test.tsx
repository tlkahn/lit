import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SplitPreviewDialog, computeOutputPath } from "./SplitPreviewDialog";
import type { SplitPlan } from "../lib/ipc";

const planWithPreamble: SplitPlan = {
  preamble: { title: "Doc - Introduction", body: "Intro text.\nLine 2.\nLine 3.\nLine 4.", frontmatter: {} },
  sections: [
    { title: "Alpha", body: "Alpha body.\nMore.\nMore.", frontmatter: {} },
    { title: "Beta", body: "Beta body.\nExtra.", frontmatter: {} },
  ],
};

const planWithoutPreamble: SplitPlan = {
  preamble: null,
  sections: [
    { title: "Alpha", body: "Alpha body.\nLine 2.\nLine 3.", frontmatter: {} },
    { title: "Beta", body: "Beta body.", frontmatter: {} },
  ],
};

describe("SplitPreviewDialog", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <SplitPreviewDialog open={false} plan={planWithoutPreamble} originalPath="notes/Doc.md" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='split-preview-dialog']")).toBeNull();
  });

  it("preamble shown first when present", () => {
    const { container } = render(
      <SplitPreviewDialog open={true} plan={planWithPreamble} originalPath="notes/Doc.md" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const items = container.querySelectorAll("[data-testid='split-section-item']");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("Doc - Introduction");
  });

  it("each section shows title and content preview (first 3 lines)", () => {
    const { container } = render(
      <SplitPreviewDialog open={true} plan={planWithPreamble} originalPath="notes/Doc.md" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const previews = container.querySelectorAll("[data-testid='split-body-preview']");
    expect(previews.length).toBeGreaterThan(0);
    const firstPreview = previews[0]!.textContent!;
    expect(firstPreview.split("\n")).toHaveLength(3);
  });

  it("each item shows output path", () => {
    const { container } = render(
      <SplitPreviewDialog open={true} plan={planWithoutPreamble} originalPath="notes/Doc.md" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const paths = container.querySelectorAll("[data-testid='split-output-path']");
    expect(paths[0]!.textContent).toBe("notes/Alpha.md");
    expect(paths[1]!.textContent).toBe("notes/Beta.md");
  });

  it("computeOutputPath combines dir + section title", () => {
    expect(computeOutputPath("notes/Doc.md", "Section A")).toBe("notes/Section A.md");
    expect(computeOutputPath("Doc.md", "Intro")).toBe("Intro.md");
    expect(computeOutputPath("deep/path/File.md", "Title")).toBe("deep/path/Title.md");
  });

  it("confirm button calls onConfirm", () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <SplitPreviewDialog open={true} plan={planWithoutPreamble} originalPath="Doc.md" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(container.querySelector("[data-testid='split-confirm-btn']")!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancel button and escape key call onCancel", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <SplitPreviewDialog open={true} plan={planWithoutPreamble} originalPath="Doc.md" onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(container.querySelector("[data-testid='split-cancel-btn']")!);
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("file icon rendered for each item", () => {
    const { container } = render(
      <SplitPreviewDialog open={true} plan={planWithoutPreamble} originalPath="Doc.md" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const icons = container.querySelectorAll("[data-testid='split-file-icon']");
    expect(icons).toHaveLength(2);
  });
});
