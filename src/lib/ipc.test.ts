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
  trashPage,
  restorePage,
  purgePage,
  listTrash,
  emptyTrash,
  acknowledgeFileHash,
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
  getMenuShortcuts,
  getPreferencesRaw,
  setPreferencesRaw,
  resolveAllDecorations,
  getDefinitions,
  expandTemplate,
  resolveBibEntries,
  renderBibCitations,
  pdfOpen,
  pdfRenderPage,
  pdfPrefetch,
  pdfClose,
  openInExternalEditor,
  getUnlinkedMentions,
  linkUnlinkedMention,
  rebuildGraphIndex,
  resetGraphLayout,
  searchTags,
  listPagesByTag,
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
  getFullSubgraph,
  getGraphPositions,
  ensureGraphReady,
  parseAnnotations,
  resolveAnnotationScope,
  resolveAnnotationScopeWithMode,
  searchAnnotations,
  listAnnotations,
  exportData,
  exportSubgraph,
  getLicenseStatus,
  activateLicense,
  checkOnlineValidation,
  syncLicenseMenu,
  setApiKey,
  getApiKey,
  hasApiKey,
  deleteApiKey,
  llmPromptStreaming,
  llmCancel,
  testLlmConnection,
  undoLastOperation,
  listUndoHistory,
  canUndo,
  rewriteVaultLinks,
  previewMerge,
  previewSplit,
  suggestMergeTitle,
  mergeDocuments,
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
        case "trash_page":
          return {
            trash_name: `${(args as Record<string, unknown>)?.relativePath}.1716556800.md`,
            original_path: (args as Record<string, unknown>)?.relativePath,
            deleted_at: 1716556800,
          };
        case "restore_page":
          return "restored.md";
        case "purge_page":
          return null;
        case "list_trash":
          return [
            { trash_name: "a.123.md", original_path: "a.md", deleted_at: 123 },
          ];
        case "empty_trash":
          return null;
        case "acknowledge_file_hash":
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
            { key: "Mod-b", command: "editor.toggleBold", when: "editorFocus", source: "default" },
          ];
        case "get_default_keymaps":
          return [
            { key: "Mod-b", command: "editor.toggleBold", when: "editorFocus" },
          ];
        case "get_user_keymaps_path":
          return "/data/keymaps/user.json";
        case "save_user_keymaps":
          return null;
        case "get_menu_shortcuts":
          return [
            { key: "Mod-,", command: "core.settings.open", source: "menu" },
            { key: "Mod-Shift-s", command: "app.exportMarkdown", source: "menu" },
            { key: "Mod-Shift-e", command: "editor.openInExternalEditor", source: "menu" },
          ];
        case "get_preferences_raw":
          return '{"a":1}';
        case "set_preferences_raw":
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
            png_path: `/tmp/lit-pdf/page_${(args as Record<string, unknown>)?.pageIndex ?? 0}.png`,
            width: 612,
            height: 792,
          };
        case "pdf_prefetch":
          return null;
        case "pdf_close":
          return null;
        case "open_in_external_editor":
          return null;
        case "parse_annotations": {
          const a = args as Record<string, unknown> | undefined;
          if (!a?.content || (a.content as string).length === 0) return [];
          return [
            {
              form: "compact",
              annotation_type: "note",
              certainty: "neutral",
              scope: { kind: "sentence", value: 1 },
              body: "a note",
              date: null,
              is_structured: true,
              char_start: 0,
              char_end: 16,
              original: "%%! n: | a note %%",
            },
          ];
        }
        case "resolve_annotation_scope": {
          const a = args as Record<string, unknown> | undefined;
          if ((a?.charStart as number) === 0) return null;
          return { start: 6, end: 11 };
        }
        case "resolve_annotation_scope_with_mode": {
          const a = args as Record<string, unknown> | undefined;
          if ((a?.charStart as number) === 0) return null;
          return { start: 2, end: 15 };
        }
        case "search_annotations": {
          const a = args as Record<string, unknown> | undefined;
          if (a?.annotationType) {
            return [
              {
                annotation_id: 1,
                node_id: "a.md",
                node_title: "Alpha",
                annotation_type: a.annotationType,
                certainty: "neutral",
                body: "found by search",
                date: null,
                source_line: 3,
                char_start: 10,
                char_end: 30,
              },
            ];
          }
          return [
            {
              annotation_id: 1,
              node_id: "a.md",
              node_title: "Alpha",
              annotation_type: "note",
              certainty: "neutral",
              body: "Silk Road flourished",
              date: null,
              source_line: 5,
              char_start: 10,
              char_end: 50,
            },
          ];
        }
        case "list_annotations": {
          const a = args as Record<string, unknown> | undefined;
          if (a?.annotationType) {
            return [
              {
                annotation_id: 2,
                node_id: a?.nodeId ?? "a.md",
                node_title: "Alpha",
                annotation_type: a.annotationType,
                certainty: "firm",
                body: "filtered note",
                date: null,
                source_line: 1,
                char_start: 0,
                char_end: 20,
              },
            ];
          }
          return [
            {
              annotation_id: 1,
              node_id: a?.nodeId ?? "a.md",
              node_title: "Alpha",
              annotation_type: "note",
              certainty: "neutral",
              body: "a note",
              date: null,
              source_line: 1,
              char_start: 0,
              char_end: 10,
            },
            {
              annotation_id: 2,
              node_id: a?.nodeId ?? "a.md",
              node_title: "Alpha",
              annotation_type: "question",
              certainty: "tentative",
              body: "a question",
              date: null,
              source_line: 3,
              char_start: 20,
              char_end: 40,
            },
          ];
        }
        case "export_data":
          return { exported_count: 42, destination: (args as Record<string, unknown>)?.destination ?? "" };
        case "export_subgraph":
          return { exported_count: 7, destination: (args as Record<string, unknown>)?.destination ?? "" };
        case "get_license_status":
          return { state: "trial", days_remaining: 12 };
        case "activate_license":
          return { state: "licensed", licensed_to: "Test User" };
        case "check_online_validation":
          return { action: "skipped", reason: "not_due" };
        case "sync_license_menu":
          return undefined;
        case "set_api_key":
          return null;
        case "get_api_key":
          return "sk-test123";
        case "has_api_key":
          return true;
        case "delete_api_key":
          return null;
        case "llm_prompt_streaming":
          return null;
        case "llm_cancel":
          return null;
        case "llm_test_connection":
          return null;
        case "undo_last_operation":
          return "Create 'Test Page'";
        case "list_undo_history": {
          const a = args as Record<string, unknown> | undefined;
          return [
            {
              id: 1,
              op_type: "create_page",
              description: "Create 'Alpha'",
              created_at: 1700000000000,
            },
            ...(a?.limit === 1
              ? []
              : [
                  {
                    id: 2,
                    op_type: "delete_page",
                    description: "Delete 'Beta'",
                    created_at: 1700000001000,
                  },
                ]),
          ];
        }
        case "can_undo":
          return true;
        case "rewrite_vault_links":
          return {
            files_scanned: 3,
            files_modified: [
              { relative_path: "a.md", links_changed: 1 },
              { relative_path: "b.md", links_changed: 2 },
            ],
            total_links_changed: 3,
          };
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
        case "preview_split": {
          const a = args as Record<string, unknown> | undefined;
          return {
            preamble: null,
            sections: [
              { title: "Section 1", body: "body 1", frontmatter: a?.frontmatter ?? {} },
              { title: "Section 2", body: "body 2", frontmatter: a?.frontmatter ?? {} },
            ],
          };
        }
        case "suggest_merge_title":
          throw new Error("LLM not configured");
        case "merge_documents":
          return "notes/Merged.md";
        case "search_tags":
          return [
            { tag: "rust", count: 5 },
            { tag: "rust-lang", count: 2 },
          ];
        case "list_pages_by_tag":
          return [
            { id: "a.md", title: "Alpha", first_paragraph: "First paragraph of Alpha" },
            { id: "b.md", title: "Beta", first_paragraph: "First paragraph of Beta" },
          ];
        case "get_graph_positions":
          return { "page-1": { x: 1.0, y: 2.0 }, "page-2": { x: 3.0, y: 4.0 } };
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
            { id: "a.md", title: "Alpha", score: -1.5, excerpt: "[Alpha] note", first_match_line: 7 },
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
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
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
        case "reset_graph_layout":
          return undefined;
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

  it("acknowledgeFileHash calls with relativePath", async () => {
    await acknowledgeFileHash("Hello.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("acknowledge_file_hash", { relativePath: "Hello.md" });
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

  it("getKeymaps returns merged keybindings with source", async () => {
    const bindings = await getKeymaps();
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.command).toBe("editor.toggleBold");
    expect(bindings[0]!.source).toBe("default");
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

  it("getMenuShortcuts returns menu bindings", async () => {
    const bindings = await getMenuShortcuts();
    expect(bindings).toHaveLength(3);
    expect(bindings[0]!.source).toBe("menu");
    expect(bindings[0]!.command).toBe("core.settings.open");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_menu_shortcuts");
  });

  it("getPreferencesRaw returns raw JSON string", async () => {
    const raw = await getPreferencesRaw();
    expect(raw).toBe('{"a":1}');
  });

  it("setPreferencesRaw sends json argument", async () => {
    await setPreferencesRaw('{"b":2}');
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("set_preferences_raw", { json: '{"b":2}' });
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

  it("resetGraphLayout calls correct command", async () => {
    await resetGraphLayout();
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("reset_graph_layout");
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

  it("searchPages includes first_match_line when present", async () => {
    const results = await searchPages("Alpha");
    expect(results[0]!.first_match_line).toBe(7);
  });

  it("searchPagesByTitle result has first_match_line undefined when absent", async () => {
    const results = await searchPagesByTitle("Alpha");
    expect(results[0]!.first_match_line).toBeUndefined();
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

  it("getGraphSubgraph returns subgraph with pagerank and positions", async () => {
    const result = await getGraphSubgraph(["a.md", "b.md"], 1);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.pagerank).toEqual({ "a.md": 0.4, "b.md": 0.6 });
    expect(result.positions).toEqual({});
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: ["a.md", "b.md"], depth: 1, directed: null });
  });

  it("getFullSubgraph calls get_graph_subgraph with empty seeds", async () => {
    const result = await getFullSubgraph();
    expect(result.nodes).toHaveLength(2);
    expect(result.pagerank).toEqual({ "a.md": 0.4, "b.md": 0.6 });
    expect(result.positions).toEqual({});
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", {
      seeds: [], depth: 0, directed: null,
    });
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

  it("getGraphPositions returns position map", async () => {
    const positions = await getGraphPositions();
    expect(positions["page-1"]).toEqual({ x: 1.0, y: 2.0 });
    expect(positions["page-2"]).toEqual({ x: 3.0, y: 4.0 });
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

  it("pdfPrefetch calls pdf_prefetch", async () => {
    await pdfPrefetch(1, 288);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("pdf_prefetch", { pageIndex: 1, dpi: 288 });
  });

  it("pdfClose calls pdf_close", async () => {
    await pdfClose();
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("pdf_close");
  });

  it("searchTags returns tag results", async () => {
    const results = await searchTags("rust");
    expect(results).toHaveLength(2);
    expect(results[0]!.tag).toBe("rust");
    expect(results[0]!.count).toBe(5);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("search_tags", { query: "rust", limit: null });
  });

  it("searchTags passes limit when provided", async () => {
    await searchTags("rust", 10);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("search_tags", { query: "rust", limit: 10 });
  });

  it("listPagesByTag returns page results", async () => {
    const results = await listPagesByTag("rust");
    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe("a.md");
    expect(results[0]!.title).toBe("Alpha");
    expect(results[0]!.first_paragraph).toBe("First paragraph of Alpha");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("list_pages_by_tag", { tag: "rust", limit: null });
  });

  it("listPagesByTag passes limit when provided", async () => {
    await listPagesByTag("rust", 25);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("list_pages_by_tag", { tag: "rust", limit: 25 });
  });

  it("ensureGraphReady rejects on error", async () => {
    mockInvoke((cmd) => {
      if (cmd === "ensure_graph_ready") throw new Error("build failed");
      throw new Error(`Unknown command: ${cmd}`);
    });
    await expect(ensureGraphReady("/my/workspace")).rejects.toThrow("build failed");
  });

  it("parseAnnotations returns parsed results", async () => {
    const anns = await parseAnnotations("%%! n: | a note %%");
    expect(anns).toHaveLength(1);
    expect(anns[0]!.annotation_type).toBe("note");
    expect(anns[0]!.body).toBe("a note");
    expect(anns[0]!.is_structured).toBe(true);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("parse_annotations", { content: "%%! n: | a note %%" });
  });

  it("parseAnnotations empty content returns empty array", async () => {
    const anns = await parseAnnotations("");
    expect(anns).toHaveLength(0);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("parse_annotations", { content: "" });
  });

  it("resolveAnnotationScope returns range", async () => {
    const result = await resolveAnnotationScope(
      "hello world %%! n: _ | note %%",
      12,
      { kind: "words", value: 1 },
      "en",
    );
    expect(result).toEqual({ start: 6, end: 11 });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("resolve_annotation_scope", {
      content: "hello world %%! n: _ | note %%",
      charStart: 12,
      scope: { kind: "words", value: 1 },
      lang: "en",
    });
  });

  it("resolveAnnotationScope returns null when unresolvable", async () => {
    const result = await resolveAnnotationScope(
      "%%! n: _ | note %%",
      0,
      { kind: "words", value: 1 },
      "en",
    );
    expect(result).toBeNull();
  });

  it("resolveAnnotationScopeWithMode calls IPC with mode arg", async () => {
    const result = await resolveAnnotationScopeWithMode(
      "hello world %%! llm | explain %%",
      12,
      { kind: "sentence", value: 1 },
      "en",
      "bidirectional",
    );
    expect(result).toEqual({ start: 2, end: 15 });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("resolve_annotation_scope_with_mode", {
      content: "hello world %%! llm | explain %%",
      charStart: 12,
      scope: { kind: "sentence", value: 1 },
      lang: "en",
      mode: "bidirectional",
    });
  });

  it("resolveAnnotationScopeWithMode returns null when unresolvable", async () => {
    const result = await resolveAnnotationScopeWithMode(
      "%%! llm | explain %%",
      0,
      { kind: "sentence", value: 1 },
      "en",
      "backward",
    );
    expect(result).toBeNull();
  });

  it("searchAnnotations returns results", async () => {
    const results = await searchAnnotations("Silk Road");
    expect(results).toHaveLength(1);
    expect(results[0]!.node_id).toBe("a.md");
    expect(results[0]!.body).toBe("Silk Road flourished");
    expect(results[0]!.annotation_type).toBe("note");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("search_annotations", {
      query: "Silk Road",
      annotationType: null,
      limit: null,
    });
  });

  it("searchAnnotations with type filter", async () => {
    const results = await searchAnnotations("important", "note");
    expect(results).toHaveLength(1);
    expect(results[0]!.annotation_type).toBe("note");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("search_annotations", {
      query: "important",
      annotationType: "note",
      limit: null,
    });
  });

  it("listAnnotations returns results", async () => {
    const results = await listAnnotations("a.md");
    expect(results).toHaveLength(2);
    expect(results[0]!.annotation_type).toBe("note");
    expect(results[1]!.annotation_type).toBe("question");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("list_annotations", {
      nodeId: "a.md",
      annotationType: null,
      limit: null,
    });
  });

  it("listAnnotations with type filter", async () => {
    const results = await listAnnotations("a.md", "note");
    expect(results).toHaveLength(1);
    expect(results[0]!.annotation_type).toBe("note");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("list_annotations", {
      nodeId: "a.md",
      annotationType: "note",
      limit: null,
    });
  });

  it("listAnnotations vault-wide (no nodeId)", async () => {
    const results = await listAnnotations();
    expect(results).toHaveLength(2);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("list_annotations", {
      nodeId: null,
      annotationType: null,
      limit: null,
    });
  });

  it("exportData calls export_data with destination", async () => {
    const summary = await exportData("/tmp/out.zip");
    expect(summary.exported_count).toBe(42);
    expect(summary.destination).toBe("/tmp/out.zip");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("export_data", { destination: "/tmp/out.zip" });
  });

  it("exportSubgraph calls export_subgraph with nodeId, depth, destination", async () => {
    const summary = await exportSubgraph("concepts/ai.md", 2, "/tmp/subgraph.zip");
    expect(summary.exported_count).toBe(7);
    expect(summary.destination).toBe("/tmp/subgraph.zip");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("export_subgraph", {
      nodeId: "concepts/ai.md",
      depth: 2,
      destination: "/tmp/subgraph.zip",
    });
  });

  it("getLicenseStatus calls get_license_status", async () => {
    const status = await getLicenseStatus();
    expect(status.state).toBe("trial");
    expect(status.days_remaining).toBe(12);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_license_status");
  });

  it("activateLicense passes key arg correctly", async () => {
    const status = await activateLicense("LICENSE-KEY-123");
    expect(status.state).toBe("licensed");
    expect(status.licensed_to).toBe("Test User");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("activate_license", { key: "LICENSE-KEY-123" });
  });

  it("checkOnlineValidation returns structured result", async () => {
    const result = await checkOnlineValidation();
    expect(result.action).toBe("skipped");
    expect(result.reason).toBe("not_due");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("check_online_validation");
  });

  it("syncLicenseMenu calls sync_license_menu with licenseState", async () => {
    await syncLicenseMenu("trial");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("sync_license_menu", { licenseState: "trial" });
  });

  it("setApiKey invokes set_api_key with provider and key", async () => {
    await setApiKey("openai", "sk-abc123");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("set_api_key", { provider: "openai", key: "sk-abc123" });
  });

  it("getApiKey invokes get_api_key and returns string", async () => {
    const key = await getApiKey("openai");
    expect(key).toBe("sk-test123");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_api_key", { provider: "openai" });
  });

  it("hasApiKey invokes has_api_key and returns boolean", async () => {
    const result = await hasApiKey("openai");
    expect(result).toBe(true);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("has_api_key", { provider: "openai" });
  });

  it("deleteApiKey invokes delete_api_key with provider", async () => {
    await deleteApiKey("anthropic");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("delete_api_key", { provider: "anthropic" });
  });

  it("llmPromptStreaming invokes llm_prompt_streaming with args", async () => {
    await llmPromptStreaming({ model: "claude-sonnet-4-6", text: "hello" });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_prompt_streaming", {
      args: {
        model: "claude-sonnet-4-6",
        text: "hello",
        system: null,
        messages: [],
        options: {},
        base_url: null,
        api_key: null,
      },
    });
  });

  it("llmPromptStreaming passes optional fields", async () => {
    await llmPromptStreaming({
      model: "gpt-4o",
      text: "test",
      system: "be helpful",
      messages: [{ role: "user", content: "hi" }],
      options: { temperature: 0.5 },
      baseUrl: "https://api.example.com",
      apiKey: "sk-123",
    });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_prompt_streaming", {
      args: {
        model: "gpt-4o",
        text: "test",
        system: "be helpful",
        messages: [{ role: "user", content: "hi" }],
        options: { temperature: 0.5 },
        base_url: "https://api.example.com",
        api_key: "sk-123",
      },
    });
  });

  it("llmCancel invokes llm_cancel", async () => {
    await llmCancel();
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_cancel");
  });

  it("testLlmConnection invokes llm_test_connection with model and baseUrl", async () => {
    await testLlmConnection("gpt-4o", "https://api.example.com");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_test_connection", {
      model: "gpt-4o",
      baseUrl: "https://api.example.com",
    });
  });

  it("testLlmConnection sends null baseUrl when omitted", async () => {
    await testLlmConnection("claude-sonnet-4-6");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_test_connection", {
      model: "claude-sonnet-4-6",
      baseUrl: null,
    });
  });

  it("trashPage calls trash_page with relativePath", async () => {
    const entry = await trashPage("Doomed.md");
    expect(entry.original_path).toBe("Doomed.md");
    expect(entry.deleted_at).toBe(1716556800);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("trash_page", { relativePath: "Doomed.md" });
  });

  it("restorePage calls restore_page with trashName", async () => {
    const original = await restorePage("a.123.md");
    expect(original).toBe("restored.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("restore_page", { trashName: "a.123.md" });
  });

  it("purgePage calls purge_page with trashName", async () => {
    await purgePage("a.123.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("purge_page", { trashName: "a.123.md" });
  });

  it("listTrash calls list_trash", async () => {
    const items = await listTrash();
    expect(items).toHaveLength(1);
    expect(items[0]!.trash_name).toBe("a.123.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("list_trash");
  });

  it("emptyTrash calls empty_trash", async () => {
    await emptyTrash();
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("empty_trash");
  });

  it("undoLastOperation calls undo_last_operation", async () => {
    const description = await undoLastOperation();
    expect(description).toBe("Create 'Test Page'");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("undo_last_operation");
  });

  it("listUndoHistory calls with limit", async () => {
    const history = await listUndoHistory(1);
    expect(history).toHaveLength(1);
    expect(history[0]!.op_type).toBe("create_page");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("list_undo_history", { limit: 1 });
  });

  it("listUndoHistory sends null limit when omitted", async () => {
    const history = await listUndoHistory();
    expect(history).toHaveLength(2);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("list_undo_history", { limit: null });
  });

  it("canUndo returns boolean", async () => {
    const result = await canUndo();
    expect(result).toBe(true);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("can_undo");
  });

  it("rewriteVaultLinks sends snake_case redirects", async () => {
    const summary = await rewriteVaultLinks([
      { oldTarget: "OldPage", newTarget: "NewPage" },
    ]);
    expect(summary.files_scanned).toBe(3);
    expect(summary.total_links_changed).toBe(3);
    expect(summary.files_modified).toHaveLength(2);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("rewrite_vault_links", {
      redirects: [{ old_target: "OldPage", new_target: "NewPage" }],
    });
  });

  it("previewMerge invokes preview_merge and returns MergePlan", async () => {
    const docs = [
      { title: "A", body: "Hello A", frontmatter: {} },
      { title: "B", body: "Hello B", frontmatter: {} },
    ];
    const plan = await previewMerge(docs);
    expect(plan.title).toBe("A + B");
    expect(plan.source_titles).toEqual(["A", "B"]);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("preview_merge", { docs });
  });

  it("previewSplit invokes preview_split and returns SplitPlan", async () => {
    const plan = await previewSplit("## A\nBody.\n## B\nBody.", "Doc", { status: "draft" });
    expect(plan.sections).toHaveLength(2);
    expect(plan.sections[0]!.title).toBe("Section 1");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("preview_split", {
      content: "## A\nBody.\n## B\nBody.",
      title: "Doc",
      frontmatter: { status: "draft" },
    });
  });

  it("suggestMergeTitle returns null on failure", async () => {
    const result = await suggestMergeTitle(["A", "B"], "merged body");
    expect(result).toBeNull();
  });

  it("mergeDocuments invokes merge_documents and returns merged path", async () => {
    const result = await mergeDocuments(["A.md", "B.md"], "Merged", [0, 1]);
    expect(result).toBe("notes/Merged.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("merge_documents", {
      paths: ["A.md", "B.md"],
      title: "Merged",
      ordering: [0, 1],
      outputDir: null,
    });
  });

  it("mergeDocuments passes outputDir when provided", async () => {
    const result = await mergeDocuments(["A.md", "B.md"], "Merged", [0, 1], "archive");
    expect(result).toBe("notes/Merged.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("merge_documents", {
      paths: ["A.md", "B.md"],
      title: "Merged",
      ordering: [0, 1],
      outputDir: "archive",
    });
  });

});
