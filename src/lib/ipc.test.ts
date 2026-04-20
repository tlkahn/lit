import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke } from "../test/tauri-mock";
import {
  getAppInfo,
  openWorkspace,
  listPages,
  getWorkspacePath,
  readPage,
  writePage,
  createPage,
  renamePage,
  deletePage,
} from "./ipc";

const sampleMeta = {
  title: "Test",
  relative_path: "Test.md",
  frontmatter: {},
  created_at: 1000,
  modified_at: 2000,
};

describe("ipc", () => {
  beforeEach(() => {
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "get_app_info":
          return { name: "Lit", version: "0.1.0" };
        case "open_workspace":
          return [sampleMeta];
        case "list_pages":
          return [sampleMeta];
        case "get_workspace_path":
          return "/workspace";
        case "read_page":
          return { meta: sampleMeta, body: "# Hello" };
        case "write_page":
          return null;
        case "create_page":
          return { ...sampleMeta, title: (args as Record<string, unknown>)?.name };
        case "rename_page":
          return "New.md";
        case "delete_page":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
  });

  it("getAppInfo returns name and version", async () => {
    const info = await getAppInfo();
    expect(info).toEqual({ name: "Lit", version: "0.1.0" });
  });

  it("openWorkspace calls with path", async () => {
    const pages = await openWorkspace("/my/workspace");
    expect(pages).toHaveLength(1);
    expect(pages[0]!.title).toBe("Test");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("open_workspace", { path: "/my/workspace" });
  });

  it("listPages returns page list", async () => {
    const pages = await listPages();
    expect(pages).toHaveLength(1);
  });

  it("getWorkspacePath returns path", async () => {
    const path = await getWorkspacePath();
    expect(path).toBe("/workspace");
  });

  it("readPage calls with relativePath", async () => {
    const content = await readPage("Test.md");
    expect(content.body).toBe("# Hello");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("read_page", { relativePath: "Test.md" });
  });

  it("writePage calls with correct args", async () => {
    await writePage("Test.md", "# Updated", { title: "Test" });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("write_page", {
      relativePath: "Test.md",
      body: "# Updated",
      frontmatter: { title: "Test" },
    });
  });

  it("createPage calls with name and parentDir", async () => {
    const meta = await createPage("New Page", "subfolder");
    expect(meta.title).toBe("New Page");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("create_page", {
      name: "New Page",
      parentDir: "subfolder",
    });
  });

  it("createPage sends null parentDir when omitted", async () => {
    await createPage("Root Page");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("create_page", {
      name: "Root Page",
      parentDir: null,
    });
  });

  it("renamePage calls with old path and new name", async () => {
    const newPath = await renamePage("Old.md", "New");
    expect(newPath).toBe("New.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("rename_page", {
      oldPath: "Old.md",
      newName: "New",
    });
  });

  it("deletePage calls with relativePath", async () => {
    await deletePage("Doomed.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("delete_page", { relativePath: "Doomed.md" });
  });
});
