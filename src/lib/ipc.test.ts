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
  getStartupContext,
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
  pdfOpen,
  pdfRenderPage,
  pdfClose,
  openInExternalEditor,
  getUnlinkedMentions,
  linkUnlinkedMention,
  rebuildGraphIndex,
  resolveWikilink,
  getPageHeadings,
  getPagerank,
  getBacklinks,
  getForwardLinks,
  searchPages,
  searchPagesByTitle,
  getGraphStats,
  getGraphNeighbors,
  getGraphPaths,
  getGraphSubgraph,
  ensureGraphReady,
} from "./ipc";

const sampleMeta = {
  title: "Test",
  relative_path: "Test.md",
  frontmatter: {},
  created_at: 1000,
  modified_at: 2000,
  file_type: 'markdown' as const,
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
        case "get_startup_context":
          return { workspace: "/my/vault", file: "notes.md", line: 10, col: 5 };
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
        case "get_unlinked_mentions":
          return [
            {
              source_id: "c.md",
              source_title: "Gamma",
              context: "mentions Alpha in passing",
              source_line: 3,
              matched_text: "Alpha",
            },
          ];
        case "link_unlinked_mention":
          return null;
        case "pdf_open":
          return { page_count: 3, path: (args as Record<string, unknown>)?.path ?? "" };
        case "pdf_render_page":
          return {
            page_index: (args as Record<string, unknown>)?.pageIndex ?? 0,
            png_base64: "iVBOR...",
            width: 612,
            height: 792,
          };
        case "pdf_close":
          return null;
        case "open_in_external_editor":
          return null;
        case "ensure_graph_ready":
          return null;
        case "get_backlinks":
          return [
            { source_id: "a.md", source_title: "Alpha", context: "links to b" },
          ];
        case "get_forward_links":
          return [
            { target_id: "b.md", target_title: "Beta", raw_target: "B", context: "see B" },
          ];
        case "search_pages":
          return [
            { id: "a.md", title: "Alpha", score: -1.5, excerpt: "[Alpha] note" },
          ];
        case "search_pages_by_title":
          return [
            { id: "a.md", title: "Alpha", score: 0, excerpt: "" },
          ];
        case "get_graph_stats":
          return { nodes: 5, stubs: 1, edges: 3, tags: 2 };
        case "get_graph_neighbors":
          return {
            nodes: [{ id: "a.md", title: "A", is_stub: false }],
            edges: [["a.md", "b.md"]],
          };
        case "get_graph_paths":
          return [["a.md", "b.md", "c.md"]];
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
          };
        case "resolve_wikilink": {
          const a = args as Record<string, unknown> | undefined;
          if (a?.target === "NonExistent") {
            return { target: "NonExistent", node_id: null, tier: "Unresolved" };
          }
          return { target: a?.target ?? "", node_id: "Notes/Topic.md", tier: "Stem" };
        }
        case "get_page_headings":
          return [
            { text: "Introduction", level: 1 },
            { text: "Details", level: 2 },
          ];
        case "rebuild_graph_index":
          return "Rebuilt: 5 nodes, 3 edges, 1 stubs";
        case "get_pagerank": {
          const a = args as Record<string, unknown> | undefined;
          if (a?.n != null) {
            return [["b.md", 0.6], ["a.md", 0.4]];
          }
          return { "a.md": 0.4, "b.md": 0.6 };
        }
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

  it("getStartupContext returns startup context", async () => {
    const ctx = await getStartupContext();
    expect(ctx).toEqual({ workspace: "/my/vault", file: "notes.md", line: 10, col: 5 });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_startup_context");
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

  it("openInExternalEditor calls with correct args", async () => {
    await openInExternalEditor("notes.md", 10, 5);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("open_in_external_editor", {
      relativePath: "notes.md",
      line: 10,
      col: 5,
    });
  });

  it("getPageHeadings returns headings array", async () => {
    const headings = await getPageHeadings("My Page");
    expect(headings).toHaveLength(2);
    expect(headings[0]!.text).toBe("Introduction");
    expect(headings[0]!.level).toBe(1);
    expect(headings[1]!.text).toBe("Details");
    expect(headings[1]!.level).toBe(2);
  });

  it("getPageHeadings passes target correctly", async () => {
    await getPageHeadings("My Page");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_page_headings", { target: "My Page" });
  });

  it("rebuildGraphIndex calls correct command", async () => {
    const result = await rebuildGraphIndex();
    expect(result).toBe("Rebuilt: 5 nodes, 3 edges, 1 stubs");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("rebuild_graph_index");
  });

  it("getPagerank returns full scores map", async () => {
    const scores = await getPagerank();
    expect(scores).toEqual({ "a.md": 0.4, "b.md": 0.6 });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_pagerank", { n: null });
  });

  it("getPagerank returns top-N", async () => {
    const top = await getPagerank(2);
    expect(top).toEqual([["b.md", 0.6], ["a.md", 0.4]]);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_pagerank", { n: 2 });
  });

  it("getBacklinks returns backlink entries", async () => {
    const bl = await getBacklinks("b.md");
    expect(bl).toHaveLength(1);
    expect(bl[0]!.source_id).toBe("a.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_backlinks", { pageId: "b.md" });
  });

  it("getForwardLinks returns link entries", async () => {
    const fl = await getForwardLinks("a.md");
    expect(fl).toHaveLength(1);
    expect(fl[0]!.target_id).toBe("b.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_forward_links", { pageId: "a.md" });
  });

  it("searchPages returns results", async () => {
    const results = await searchPages("Alpha");
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("a.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("search_pages", { query: "Alpha", limit: null });
  });

  it("searchPages passes limit when provided", async () => {
    await searchPages("Alpha", 5);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("search_pages", { query: "Alpha", limit: 5 });
  });

  it("searchPagesByTitle returns results", async () => {
    const results = await searchPagesByTitle("Alpha");
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("a.md");
    expect(results[0]!.score).toBe(0);
    expect(results[0]!.excerpt).toBe("");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("search_pages_by_title", { query: "Alpha", limit: null });
  });

  it("searchPagesByTitle passes limit when provided", async () => {
    await searchPagesByTitle("Alpha", 5);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("search_pages_by_title", { query: "Alpha", limit: 5 });
  });

  it("getGraphStats returns stats", async () => {
    const stats = await getGraphStats();
    expect(stats.nodes).toBe(5);
    expect(stats.edges).toBe(3);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_graph_stats");
  });

  it("getGraphNeighbors returns subgraph", async () => {
    const result = await getGraphNeighbors("a.md", 1);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_graph_neighbors", { id: "a.md", depth: 1, directed: null });
  });

  it("getGraphPaths returns paths", async () => {
    const paths = await getGraphPaths("a.md", "c.md", 3);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toEqual(["a.md", "b.md", "c.md"]);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_graph_paths", { from: "a.md", to: "c.md", maxDepth: 3, directed: null });
  });

  it("resolveWikilink calls resolve_wikilink with target", async () => {
    const result = await resolveWikilink("Topic");
    expect(result.node_id).toBe("Notes/Topic.md");
    expect(result.tier).toBe("Stem");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("resolve_wikilink", { target: "Topic" });
  });

  it("resolveWikilink returns null node_id for unresolved", async () => {
    const result = await resolveWikilink("NonExistent");
    expect(result.node_id).toBeNull();
    expect(result.tier).toBe("Unresolved");
  });

  it("getGraphSubgraph returns subgraph", async () => {
    const result = await getGraphSubgraph(["a.md", "b.md"], 1);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: ["a.md", "b.md"], depth: 1, directed: null });
  });

  it("getUnlinkedMentions returns mention entries", async () => {
    const mentions = await getUnlinkedMentions("a.md");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.source_id).toBe("c.md");
    expect(mentions[0]!.matched_text).toBe("Alpha");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_unlinked_mentions", { pageId: "a.md" });
  });

  it("linkUnlinkedMention calls with correct args", async () => {
    await linkUnlinkedMention("c.md", 3, "Alpha");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("link_unlinked_mention", {
      sourceId: "c.md",
      sourceLine: 3,
      matchedText: "Alpha",
    });
  });

  it("ensureGraphReady calls with path", async () => {
    await ensureGraphReady("/my/workspace");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("ensure_graph_ready", { path: "/my/workspace" });
  });

  it("ensureGraphReady resolves on success", async () => {
    await expect(ensureGraphReady("/my/workspace")).resolves.toBeNull();
  });

  it("pdfOpen calls pdf_open with path", async () => {
    const info = await pdfOpen("/path/to/doc.pdf");
    expect(info.page_count).toBe(3);
    expect(info.path).toBe("/path/to/doc.pdf");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("pdf_open", { path: "/path/to/doc.pdf" });
  });

  it("pdfRenderPage calls pdf_render_page", async () => {
    const page = await pdfRenderPage(1, 288);
    expect(page.page_index).toBe(1);
    expect(page.width).toBe(612);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("pdf_render_page", { pageIndex: 1, dpi: 288 });
  });

  it("pdfClose calls pdf_close", async () => {
    await pdfClose();
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("pdf_close");
  });

  it("ensureGraphReady rejects on error", async () => {
    mockInvoke((cmd) => {
      if (cmd === "ensure_graph_ready") throw new Error("build failed");
      throw new Error(`Unknown command: ${cmd}`);
    });
    await expect(ensureGraphReady("/my/workspace")).rejects.toThrow("build failed");
  });

});
