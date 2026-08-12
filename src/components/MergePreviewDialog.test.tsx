import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { MergePreviewDialog, reorderArray } from "./MergePreviewDialog";
import { mockInvoke } from "../test/tauri-mock";
import type { PageContent } from "../lib/ipc";

function makeDocs(titles: string[]): PageContent[] {
  return titles.map((title) => ({
    meta: {
      title,
      relative_path: `${title}.md`,
      frontmatter: {},
      created_at: 1000,
      modified_at: 2000,
      file_type: "markdown" as const,
      has_companion: false,
    },
    body: `Body of ${title}`,
    raw_yaml: "",
  }));
}

function makeDocsWithFm(entries: Array<{ title: string; frontmatter: Record<string, unknown> }>): PageContent[] {
  return entries.map(({ title, frontmatter }) => ({
    meta: {
      title,
      relative_path: `${title}.md`,
      frontmatter,
      created_at: 1000,
      modified_at: 2000,
      file_type: "markdown" as const,
      has_companion: false,
    },
    body: `Body of ${title}`,
    raw_yaml: "",
  }));
}

describe("MergePreviewDialog", () => {
  beforeEach(() => {
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "preview_merge": {
          const a = args as Record<string, unknown> | undefined;
          const docs = a?.docs as Array<{ title: string; body: string; frontmatter: Record<string, unknown> }>;
          return {
            title: docs.map((d) => d.title).join(" + "),
            body: docs.map((d) => `## ${d.title}\n\n${d.body}\n`).join("\n"),
            frontmatter: {},
            source_titles: docs.map((d) => d.title),
          };
        }
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <MergePreviewDialog open={false} docs={makeDocs(["A", "B"])} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='merge-preview-dialog']")).toBeNull();
  });

  it("title input pre-filled with joined titles", () => {
    const { container } = render(
      <MergePreviewDialog open={true} docs={makeDocs(["A", "B", "C"])} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const input = container.querySelector("[data-testid='merge-title-input']") as HTMLInputElement;
    expect(input.value).toBe("A + B + C");
  });

  it("title input is editable", () => {
    const { container } = render(
      <MergePreviewDialog open={true} docs={makeDocs(["A", "B"])} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const input = container.querySelector("[data-testid='merge-title-input']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Custom Title" } });
    expect(input.value).toBe("Custom Title");
  });

  it("shows ordered list of source docs", () => {
    const { container } = render(
      <MergePreviewDialog open={true} docs={makeDocs(["X", "Y", "Z"])} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const items = container.querySelectorAll("[data-testid='merge-section-item']");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("X");
    expect(items[1]!.textContent).toContain("Y");
    expect(items[2]!.textContent).toContain("Z");
  });

  it("reorderArray moves item from one index to another", () => {
    expect(reorderArray(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorderArray(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(reorderArray([1, 2, 3, 4], 1, 3)).toEqual([1, 3, 4, 2]);
  });

  it("confirm calls onConfirm with MergePlan and ordering", async () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <MergePreviewDialog open={true} docs={makeDocs(["A", "B"])} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(container.querySelector("[data-testid='merge-confirm-btn']")!);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [plan, ordering] = onConfirm.mock.calls[0]!;
    expect(plan.title).toBe("A + B");
    expect(plan.source_titles).toEqual(["A", "B"]);
    expect(ordering).toEqual([0, 1]);
  });

  it("cancel calls onCancel", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <MergePreviewDialog open={true} docs={makeDocs(["A", "B"])} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(container.querySelector("[data-testid='merge-cancel-btn']")!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("escape key calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <MergePreviewDialog open={true} docs={makeDocs(["A", "B"])} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("frontmatter panel shows merged keys", () => {
    const docs = makeDocsWithFm([
      { title: "A", frontmatter: { status: "draft", author: "Alice" } },
      { title: "B", frontmatter: { status: "draft", tags: ["rust"] } },
    ]);
    const { container } = render(
      <MergePreviewDialog open={true} docs={docs} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const panel = container.querySelector("[data-testid='merge-fm-panel']");
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain("status");
    expect(panel!.textContent).toContain("author");
    expect(panel!.textContent).toContain("tags");
  });

  it("conflicting keys highlighted amber", () => {
    const docs = makeDocsWithFm([
      { title: "A", frontmatter: { status: "draft" } },
      { title: "B", frontmatter: { status: "done" } },
    ]);
    const { container } = render(
      <MergePreviewDialog open={true} docs={docs} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const conflicts = container.querySelectorAll("[data-testid='merge-fm-conflict']");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.textContent).toContain("status");
  });

  it("no AI title suggestion UI exists (#1010)", () => {
    const { container } = render(
      <MergePreviewDialog open={true} docs={makeDocs(["A", "B"])} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='merge-suggest-title-btn']")).toBeNull();
    // Title defaults to the deterministic join — no network needed.
    const input = container.querySelector("[data-testid='merge-title-input']") as HTMLInputElement;
    expect(input.value).toBe("A + B");
  });

  it("confirm does not throw when previewMerge rejects", async () => {
    mockInvoke((cmd) => {
      if (cmd === "preview_merge") throw new Error("IPC failure");
      throw new Error(`Unknown: ${cmd}`);
    });

    const onConfirm = vi.fn();
    const { container } = render(
      <MergePreviewDialog open={true} docs={makeDocs(["A", "B"])} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(container.querySelector("[data-testid='merge-confirm-btn']")!);
    await waitFor(() => {
      const btn = container.querySelector("[data-testid='merge-confirm-btn']")!;
      expect(btn.textContent).toBe("Merge");
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });


});
