import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LkgExportDialog, LkgImportDialog } from "./LkgBundleDialog";

describe("LkgExportDialog", () => {
  it("renders nothing when visible=false", () => {
    const { container } = render(
      <LkgExportDialog visible={false} progress={{ current: 5, total: 20 }} result={null} />,
    );
    expect(container.querySelector("[data-testid='lkg-export-dialog']")).toBeNull();
  });

  it("shows progress bar with current/total", () => {
    const { container } = render(
      <LkgExportDialog visible={true} progress={{ current: 5, total: 20 }} result={null} />,
    );
    expect(container.textContent).toContain("5 / 20");
    const bar = container.querySelector("progress");
    expect(bar).toBeTruthy();
    expect(bar!.value).toBe(5);
    expect(bar!.max).toBe(20);
  });

  it("shows export summary with count and content hash", () => {
    const { container } = render(
      <LkgExportDialog
        visible={true}
        progress={null}
        result={{ exported_count: 7, destination: "/tmp/graph.lkg", content_hash: "sha256:abc" }}
      />,
    );
    expect(container.textContent).toContain("Exported 7 files");
    expect(container.textContent).toContain("/tmp/graph.lkg");
    expect(container.textContent).toContain("sha256:abc");
  });

  it("shows preparing state when no progress or result", () => {
    const { container } = render(
      <LkgExportDialog visible={true} progress={null} result={null} />,
    );
    expect(container.textContent).toContain("Preparing");
  });
});

describe("LkgImportDialog", () => {
  it("renders nothing when visible=false", () => {
    const { container } = render(
      <LkgImportDialog visible={false} importing={true} result={null} />,
    );
    expect(container.querySelector("[data-testid='lkg-import-dialog']")).toBeNull();
  });

  it("shows Importing… while active", () => {
    const { container } = render(
      <LkgImportDialog visible={true} importing={true} result={null} />,
    );
    expect(container.textContent).toContain("Importing");
  });

  it("shows import summary counts", () => {
    const { container } = render(
      <LkgImportDialog
        visible={true}
        importing={false}
        result={{ node_count: 12, edge_count: 8, annotation_count: 3, file_count: 5 }}
      />,
    );
    expect(container.textContent).toContain("12");
    expect(container.textContent).toContain("8");
    expect(container.textContent).toContain("3");
    expect(container.textContent).toContain("5");
    expect(container.textContent).toContain("nodes");
    expect(container.textContent).toContain("edges");
    expect(container.textContent).toContain("annotations");
    expect(container.textContent).toContain("files");
  });
});
