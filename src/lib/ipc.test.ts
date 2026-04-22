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
  parseRawYaml,
  openWorkspaceWindow,
  getPendingWorkspace,
  getKeymaps,
  getDefaultKeymaps,
  getUserKeymapsPath,
  saveUserKeymaps,
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
          return { meta: sampleMeta, body: "# Hello", raw_yaml: "" };
        case "write_page":
          return null;
        case "create_page":
          return { ...sampleMeta, title: (args as Record<string, unknown>)?.name };
        case "rename_page":
          return "New.md";
        case "delete_page":
          return null;
        case "parse_raw_yaml":
          return { title: "Hello" };
        case "open_workspace_window":
          return "workspace-1";
        case "get_pending_workspace":
          return null;
        case "get_keymaps":
          return [
            { key: "Mod-b", command: "editor.toggleBold", when: "editorFocus" },
          ];
        case "get_default_keymaps":
          return [
            { key: "Mod-b", command: "editor.toggleBold", when: "editorFocus" },
          ];
        case "get_user_keymaps_path":
          return "/data/keymaps/user.json";
        case "save_user_keymaps":
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

  it("openWorkspaceWindow calls with path", async () => {
    const label = await openWorkspaceWindow("/new/workspace");
    expect(label).toBe("workspace-1");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("open_workspace_window", { path: "/new/workspace" });
  });

  it("openWorkspaceWindow sends null when no path", async () => {
    await openWorkspaceWindow();
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("open_workspace_window", { path: null });
  });

  it("parseRawYaml invokes parse_raw_yaml", async () => {
    const result = await parseRawYaml("title: Hello\n");
    expect(result).toEqual({ title: "Hello" });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("parse_raw_yaml", { rawYaml: "title: Hello\n" });
  });

  it("getPendingWorkspace returns null by default", async () => {
    const result = await getPendingWorkspace();
    expect(result).toBeNull();
  });

  it("getKeymaps returns merged keybindings", async () => {
    const bindings = await getKeymaps();
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.command).toBe("editor.toggleBold");
  });

  it("getDefaultKeymaps returns default keybindings", async () => {
    const bindings = await getDefaultKeymaps();
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.key).toBe("Mod-b");
  });

  it("getUserKeymapsPath returns a path string", async () => {
    const path = await getUserKeymapsPath();
    expect(path).toBe("/data/keymaps/user.json");
  });

  it("saveUserKeymaps sends bindings to save_user_keymaps", async () => {
    const bindings = [{ key: "Mod-Shift-b", command: "editor.toggleBold" }];
    await saveUserKeymaps(bindings);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("save_user_keymaps", { bindings });
  });
});
