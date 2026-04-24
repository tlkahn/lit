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
  getInitialFile,
  getPendingFile,
  installCli,
  uninstallCli,
  isCliInstalled,
  getKeymaps,
  getDefaultKeymaps,
  getUserKeymapsPath,
  saveUserKeymaps,
  resolveAllDecorations,
  getDefinitions,
  expandTemplate,
  resolveBibEntries,
  renderBibCitations,
  openBibFile,
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
        case "get_initial_file":
          return "notes.md";
        case "get_pending_file":
          return null;
        case "install_cli":
          return null;
        case "uninstall_cli":
          return null;
        case "is_cli_installed":
          return true;
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
        case "resolve_all_decorations":
          return {
            citations: [
              {
                char_start: 10,
                char_end: 20,
                rendered_text: "Fig. 1",
                is_valid: true,
                original: "[@fig:cat]",
                target_line: 0,
                target_char_offset: 0,
              },
            ],
            definition_tags: [
              {
                char_start: 0,
                char_end: 9,
                rendered_text: "#Fig. 1",
                is_valid: true,
                original: "{#fig:cat}",
                ref_type: "fig",
                id: "cat",
              },
            ],
          };
        case "get_definitions":
          return [
            {
              ref_type: "fig",
              id: "cat",
              number: { Simple: 1 },
              caption: "A cat",
              line: 0,
              char_offset: 0,
            },
          ];
        case "expand_template":
          return "fig-test-001";
        case "resolve_bib_entries":
          return [
            {
              key: "smith2020",
              authors: ["Smith, John"],
              title: "A Study",
              year: "2020",
              entry_type: "article",
              line_number: 0,
              bib_file: "/path/refs.bib",
            },
          ];
        case "render_bib_citations":
          return { smith2020: "Smith 2020" };
        case "open_bib_file":
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

  it("getInitialFile returns the initial file", async () => {
    const file = await getInitialFile();
    expect(file).toBe("notes.md");
  });

  it("getPendingFile returns null by default", async () => {
    const file = await getPendingFile();
    expect(file).toBeNull();
  });

  it("installCli invokes install_cli", async () => {
    await installCli();
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("install_cli");
  });

  it("uninstallCli invokes uninstall_cli", async () => {
    await uninstallCli();
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("uninstall_cli");
  });

  it("isCliInstalled returns boolean", async () => {
    const result = await isCliInstalled();
    expect(result).toBe(true);
  });

  it("resolveAllDecorations returns citations and definition_tags", async () => {
    const result = await resolveAllDecorations("![cat](cat.png){#fig:cat}\n\n[@fig:cat]");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]!.rendered_text).toBe("Fig. 1");
    expect(result.definition_tags).toHaveLength(1);
    expect(result.definition_tags[0]!.ref_type).toBe("fig");
  });

  it("resolveAllDecorations sends null frontmatter when omitted", async () => {
    await resolveAllDecorations("content");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("resolve_all_decorations", {
      content: "content",
      frontmatter: null,
    });
  });

  it("getDefinitions returns definitions array", async () => {
    const defs = await getDefinitions("![cat](cat.png){#fig:cat}");
    expect(defs).toHaveLength(1);
    expect(defs[0]!.id).toBe("cat");
    expect(defs[0]!.caption).toBe("A cat");
  });

  it("expandTemplate returns expanded string", async () => {
    const result = await expandTemplate("fig-{filename}-{index}", "test", 1);
    expect(result).toBe("fig-test-001");
  });

  it("expandTemplate sends null for optional params", async () => {
    await expandTemplate("{tag:3}");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("expand_template", {
      template: "{tag:3}",
      filename: null,
      index: null,
      ext: null,
    });
  });

  it("resolveBibEntries returns parsed entries", async () => {
    const entries = await resolveBibEntries(["refs.bib"], "/workspace/notes");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.key).toBe("smith2020");
    expect(entries[0]!.authors).toEqual(["Smith, John"]);
  });

  it("renderBibCitations returns rendered map", async () => {
    const result = await renderBibCitations([
      {
        key: "smith2020",
        authors: ["Smith, John"],
        title: "A Study",
        year: "2020",
        entry_type: "article",
        line_number: 0,
      },
    ]);
    expect(result).toEqual({ smith2020: "Smith 2020" });
  });

  it("openBibFile invokes open_bib_file", async () => {
    await openBibFile("/path/refs.bib", 5, "code -g {file}:{line}");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("open_bib_file", {
      file: "/path/refs.bib",
      line: 5,
      commandTemplate: "code -g {file}:{line}",
    });
  });
});
