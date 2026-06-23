import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke } from "../test/tauri-mock";
import {
  getAppInfo,
  openWorkspace,
  listPages,
  getWorkspacePath,
  readPage,
  writePage,
  readCodeFile,
  writeCodeFile,
  type CodeFileContent,
  createPage,
  renamePage,
  trashPage,
  acknowledgeFileHash,
  parseRawYaml,
  openWorkspaceWindow,
  getStartupContext,
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
  listBibEntries,
  lookupDoi,
  saveBibEntry,
  parseCslJson,
  saveBibEntries,
  materializeCitation,
  enrichBibEntry,
  applyEnrichmentCandidate,
  downloadEntryPdf,
  linkEntryPdf,
  ocrPdfToMarkdown,
  checkOcrTargetExists,
  isOcrCompanionCurrent,
  type OcrProgressPayload,
  type EnrichResult,
  type SaveOutcome,
  isSaved,
  isDuplicateDoi,
  isSavedNoDoi,
  recognizePdf,
  importRecognizedEntry,
  bibSearch,
  bibGet,
  bibUpdateFields,
  bibDelete,
  getReferences,
  getReferenceCounts,
  ensureInCompanionBib,
  type RecognizeResult,
  type ConfirmReason,
  findCompanionFile,
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
  getCitingPages,
  searchPages,
  searchPagesByTitle,
  getGraphStats,
  getGraphNeighbors,
  getGraphPaths,
  getGraphSubgraph,
  getFullSubgraph,
  getBibKeyStates,
  getGraphPositions,
  ensureGraphReady,
  parseAnnotations,
  resolveAnnotationScope,
  resolveAnnotationScopeWithMode,
  resolveMarkScopes,
  getMarkConfig,
  searchAnnotations,
  listAnnotations,
  listAllAnnotations,
  exportData,
  exportSubgraph,
  exportLkg,
  importLkg,
  type LkgExportSummary,
  type LkgImportSummary,
  getLicenseStatus,
  activateLicense,
  checkOnlineValidation,
  syncLicenseMenu,
  type LicenseStatusResponse,
  type OnlineValidationResult,
  setApiKey,
  getApiKey,
  hasApiKey,
  deleteApiKey,
  llmPromptStreaming,
  llmBuildContext,
  llmCancel,
  testLlmConnection,
  undoLastOperation,
  listUndoHistory,
  canUndo,
  rewriteVaultLinks,
  previewMerge,
  previewSplit,
  executeSplit,
  suggestMergeTitle,
  cancelTitleSuggestion,
  mergeDocuments,
  annotationFindUuid,
  detectPandoc,
  exportDocument,
  type SecretStoreStatus,
  autoUnlockSecretStore,
  migrateSecretStore,
  secretStoreStatus,
  createCardboxGroup,
  renameCardboxGroup,
  dissolveCardboxGroup,
  moveCardToGroup,
  removeCardFromGroup,
  toggleGroupCollapsed,
  pinCardboxCard,
  unpinCardboxCard,
  setCardNote,
  clearCardNote,
  exportCardNote,
  setCardColor,
  clearCardColor,
  listSearchProviders,
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
          return { name: "Lit", version: "0.0.0" };
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
        case "read_code_file":
          return {
            title: "refs",
            relative_path:
              (args as Record<string, unknown>)?.relativePath ?? "refs.bib",
            body: "@article{key, title={X}}",
          };
        case "write_code_file":
          return null;
        case "create_page":
          return { ...sampleMeta, title: (args as Record<string, unknown>)?.name };
        case "rename_page":
          return "New.md";
        case "trash_page":
          return null;
        case "acknowledge_file_hash":
          return null;
        case "parse_raw_yaml":
          return { title: "Hello" };
        case "open_workspace_window":
          return "workspace-1";
        case "get_startup_context":
          return { workspace: "/my/vault", file: "notes.md", line: 10, col: 5 };
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
              doi: "10.1/x",
              journal: "Nature",
              tags: ["physics"],
            },
          ];
        case "render_bib_citations":
          return { smith2020: "Smith 2020" };
        case "list_bib_entries":
          return [
            {
              key: "smith2020",
              authors: ["Smith, John"],
              title: "A Study",
              year: "2020",
              entry_type: "article",
              line_number: 0,
              bib_file: "/path/refs.bib",
              doi: "10.1/x",
              journal: "Nature",
              tags: ["physics"],
            },
          ];
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
        case "find_companion_file":
          return (args as Record<string, unknown>)?.relativePath === "paper.md"
            ? "paper.pdf"
            : null;
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
              original: "<!--- n: | a note --->",
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
        case "resolve_mark_scopes": {
          const a = args as Record<string, unknown> | undefined;
          const marks = (a?.marks as Array<{ char_start: number }>) ?? [];
          return marks.map((m) =>
            m.char_start === 0 ? null : { start: 6, end: 11 },
          );
        }
        case "get_mark_config":
          return {
            nb: { label: "nota bene", icon: "B", style: { "font-weight": "bold" } },
            crux: { label: "crux desperationis", before: "†", after: "†" },
          };
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
                uuid: "test-uuid-1",
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
              uuid: "test-uuid-1",
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
                uuid: "test-uuid-2",
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
              uuid: "test-uuid-1",
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
              uuid: "test-uuid-2",
            },
          ];
        }
        case "list_all_annotations":
          return [
            {
              uuid: "cb-uuid-1",
              annotation_type: "note",
              certainty: "neutral",
              body: "First note",
              date: null,
              source_page_id: "a.md",
              source_page_title: "Alpha",
              source_line: 1,
              char_start: 0,
              char_end: 10,
              scope_kind: "words",
              original: null,
            },
            {
              uuid: "cb-uuid-2",
              annotation_type: "question",
              certainty: "tentative",
              body: "Why?",
              date: "2026-06-15",
              source_page_id: "b.md",
              source_page_title: "Beta",
              source_line: 5,
              char_start: 20,
              char_end: 30,
              scope_kind: "paragraph",
              original: null,
            },
          ];
        case "export_data":
          return { exported_count: 42, destination: (args as Record<string, unknown>)?.destination ?? "" };
        case "export_subgraph":
          return { exported_count: 7, destination: (args as Record<string, unknown>)?.destination ?? "" };
        case "export_lkg":
          return {
            exported_count: 12,
            destination: (args as Record<string, unknown>)?.destination ?? "",
            graph_hash: "sha256:" + "a".repeat(64),
          };
        case "import_lkg":
          return { node_count: 5, edge_count: 3, annotation_count: 2, file_count: 4 };
        case "get_license_status":
          return { state: "licensed", licensed_to: "Test User", source: "direct", expires_at: 1735603200, expiry_date: "2024-12-31" };
        case "activate_license":
          return { state: "licensed", licensed_to: "Test User", source: "direct" };
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
        case "llm_build_context": {
          const a = args as Record<string, unknown>;
          const innerArgs = a?.args as Record<string, unknown>;
          return {
            system: innerArgs?.system_prompt || "assembled",
            messages: innerArgs?.messages ?? [],
            truncation: null,
          };
        }
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
        case "execute_split":
          return ["Alpha.md", "Beta.md"];
        case "suggest_merge_title":
          throw new Error("LLM not configured");
        case "cancel_title_suggestion":
          return undefined;
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
        case "get_citing_pages":
          return [
            { source_id: "a.md", source_title: "Alpha", context: "as argued in [@smith2024]", source_line: 12 },
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
            nodes: [{ id: "a.md", title: "A", is_stub: false, materialization: "materialized" }],
            edges: [["a.md", "b.md", "wikilink"]],
          };
        case "get_graph_paths":
          return [["a.md", "b.md", "c.md"]];
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false, materialization: "materialized" },
              { id: "b.md", title: "B", is_stub: false, materialization: "materialized" },
            ],
            edges: [["a.md", "b.md", "wikilink"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "get_bib_key_states":
          return {
            smith2024: { materialization: "shadow", page_id: null },
            doe2021: { materialization: "materialized", page_id: "notes/doe2021.md" },
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
        case "annotation_find_uuid": {
          const a = args as Record<string, unknown>;
          if (a.body === null) return "uuid-for-null-body";
          return "test-uuid-abc";
        }
        case "detect_pandoc":
          return {
            pandoc_path: "/usr/local/bin/pandoc",
            pandoc_version: "pandoc 3.1.9",
            crossref_path: "/usr/local/bin/pandoc-crossref",
            crossref_version: "pandoc-crossref 0.3.17.0",
          };
        case "export_document":
          return {
            output_path: "/tmp/output.tex",
            success: true,
            stderr: "",
          };
        case "auto_unlock_secret_store":
          return true;
        case "migrate_secret_store":
          return null;
        case "secret_store_status":
          return { exists: true, unlocked: true };
        case "lookup_doi":
          return {
            key: "smith2020",
            authors: ["Smith, John"],
            title: "A Study",
            year: "2020",
            entry_type: "article",
            line_number: 0,
            doi: "10.1038/nature12373",
            journal: "Nature",
          };
        case "save_bib_entry":
          return [{ Saved: { key: "smith2020" } }];
        case "parse_csl_json":
          return [
            {
              key: "doe2021",
              authors: ["Doe, Jane"],
              title: "Parsed Paper",
              year: "2021",
              entry_type: "article",
              line_number: 0,
            },
          ];
        case "save_bib_entries":
          return [
            { Saved: { key: "doe2021" } },
            { DuplicateDoi: { doi: "10.1000/dup", existing_key: "old2019" } },
          ];
        case "materialize_citation":
          return {
            title: `Smith (2020) ${(args as Record<string, unknown>)?.bibKey}`,
            relative_path: `citations/${(args as Record<string, unknown>)?.bibKey}.md`,
            frontmatter: { citekey: (args as Record<string, unknown>)?.bibKey },
            created_at: 1000,
            modified_at: 2000,
            file_type: "markdown" as const,
          };
        case "enrich_bib_entry":
          return {
            entry: {
              key: (args as Record<string, unknown>)?.bibKey ?? "smith2020",
              authors: ["Smith, John"],
              title: "A Study",
              year: "2020",
              entry_type: "article",
              line_number: 0,
              bib_file: "/workspace/refs.bib",
              doi: "10.1/x",
              journal: "Nature",
              abstract_text: "Enriched abstract",
            },
            fields_added: ["abstract", "journal"],
            references_found: 5,
            references_appended: 5,
            shadow_nodes_created: 3,
            references_linked: 5,
            candidates: [],
            providers_searched: [],
            providers_failed: [],
          };
        case "apply_enrichment_candidate":
          return {
            entry: {
              key: (args as Record<string, unknown>)?.bibKey ?? "smith2020",
              authors: ["Smith, John"],
              title: "A Study",
              year: "2020",
              entry_type: "article",
              line_number: 0,
              bib_file: "/workspace/refs.bib",
              doi: "10.1/candidate-doi",
              journal: "Science",
              abstract_text: "Candidate abstract",
            },
            fields_added: ["doi", "journal", "abstract"],
            references_found: 3,
            references_appended: 3,
            shadow_nodes_created: 2,
            references_linked: 3,
            candidates: [],
            providers_searched: [],
            providers_failed: [],
          };
        case "download_entry_pdf":
          return "assets/pdf/smith2020.pdf";
        case "link_entry_pdf":
          return "assets/pdf/smith2020.pdf";
        case "ocr_pdf_to_markdown":
          return "smith2020.md";
        case "check_ocr_target_exists":
          return false;
        case "is_ocr_companion_current":
          return "test-paper.md";
        case "recognize_pdf": {
          return {
            kind: "resolved",
            outcome: { Saved: { key: "kucsko2013" } },
            source: "DoiContentNegotiation",
            validation: "validated",
            file: "assets/pdf/paper.pdf",
            entry: {
              key: "kucsko2013",
              authors: ["Kucsko, Georg"],
              title: "Probing condensed matter physics",
              year: "2013",
              entry_type: "article",
              line_number: 0,
              doi: "10.1038/nature12373",
              file: "assets/pdf/paper.pdf",
            },
          };
        }
        case "import_recognized_entry": {
          return [{ Saved: { key: "manual2024" } }];
        }
        case "bib_search":
          return [{
            key: "smith2020", authors: ["Smith, John"], title: "A Study",
            year: "2020", entry_type: "article", line_number: 0,
          }];
        case "bib_get": {
          const a = args as Record<string, unknown>;
          if (a?.citeKey === "nonexistent") return null;
          return {
            key: a?.citeKey ?? "smith2020",
            authors: ["Smith, John"], title: "A Study",
            year: "2020", entry_type: "article", line_number: 0,
          };
        }
        case "bib_update_fields":
          return true;
        case "bib_delete":
          return true;
        case "get_references": {
          const a = args as Record<string, unknown>;
          if (a?.bibKey === "empty_refs") return [];
          return [
            {
              key: "ref_alpha2020", authors: ["Alpha, A"], title: "Alpha Paper",
              year: "2020", entry_type: "article", line_number: 0,
            },
            {
              key: "ref_beta2021", authors: ["Beta, B"], title: "Beta Paper",
              year: "2021", entry_type: "article", line_number: 0,
            },
          ];
        }
        case "get_reference_counts":
          return { parent2024: 3, smith2020: 1 };
        case "ensure_in_companion_bib":
          return { bib_path: "assets/bib/Note.bib", bibliography_value: null };
        case "read_cardbox_layout":
          return { version: 2, order: ["u1", "u2"], links: [], groups: {}, pinned: [], notes: {}, colors: {} };
        case "write_cardbox_layout":
          return null;
        case "add_cardbox_link":
          return null;
        case "remove_cardbox_link":
          return null;
        case "create_cardbox_group":
          return null;
        case "rename_cardbox_group":
          return null;
        case "dissolve_cardbox_group":
          return null;
        case "move_card_to_group":
          return null;
        case "remove_card_from_group":
          return null;
        case "toggle_group_collapsed":
          return null;
        case "pin_cardbox_card":
          return null;
        case "unpin_cardbox_card":
          return null;
        case "set_card_note":
          return null;
        case "clear_card_note":
          return null;
        case "export_card_note":
          return "Note on Test.md";
        case "set_card_color":
          return null;
        case "clear_card_color":
          return null;
        case "list_search_providers":
          return [
            { id: "openalex", label: "OpenAlex", description: "Open catalog of the global research system", category: "general", needs_api_key: false },
            { id: "crossref", label: "Crossref", description: "DOI registration agency metadata", category: "general", needs_api_key: false },
          ];
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
  });

  it("getAppInfo returns name and version", async () => {
    const info = await getAppInfo();
    expect(info).toHaveProperty("name", "Lit");
    expect(info).toHaveProperty("version");
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

  it("readCodeFile calls read_code_file with relativePath", async () => {
    const content: CodeFileContent = await readCodeFile("refs.bib");
    expect(content.body).toBe("@article{key, title={X}}");
    expect(content.title).toBe("refs");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("read_code_file", {
      relativePath: "refs.bib",
    });
  });

  it("writeCodeFile calls write_code_file with relativePath and body", async () => {
    await writeCodeFile("a.rs", "fn main(){}");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("write_code_file", {
      relativePath: "a.rs",
      body: "fn main(){}",
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

  it("listBibEntries calls list_bib_entries with workspacePath", async () => {
    const entries = await listBibEntries("/workspace");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("list_bib_entries", { workspacePath: "/workspace" });
    expect(entries[0]!.tags).toEqual(["physics"]);
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

  it("lookupDoi invokes lookup_doi with doi string", async () => {
    const entry = await lookupDoi("10.1038/nature12373");
    expect(entry.key).toBe("smith2020");
    expect(entry.doi).toBe("10.1038/nature12373");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("lookup_doi", { doi: "10.1038/nature12373" });
  });

  it("saveBibEntry invokes save_bib_entry with entry and workspacePath (no bibPath)", async () => {
    const entry = {
      key: "",
      authors: ["Smith, John"],
      title: "Test",
      year: "2020",
      entry_type: "article",
      line_number: 0,
      doi: "10.1000/test",
    };
    const result: SaveOutcome[] = await saveBibEntry(entry, "/workspace");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ Saved: { key: "smith2020" } });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("save_bib_entry", {
      entry,
      workspacePath: "/workspace",
    });
  });

  it("parseCslJson invokes parse_csl_json with jsonPath", async () => {
    const entries = await parseCslJson("/workspace/export.json");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe("Parsed Paper");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("parse_csl_json", {
      jsonPath: "/workspace/export.json",
    });
  });

  it("saveBibEntries invokes save_bib_entries with entries and workspacePath (no bibPath)", async () => {
    const entries = [
      { key: "doe2021", authors: ["Doe, Jane"], title: "Parsed Paper", year: "2021", entry_type: "article", line_number: 0 },
    ];
    const result = await saveBibEntries(
      entries,
      "/workspace",
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ Saved: { key: "doe2021" } });
    expect(result[1]).toEqual({ DuplicateDoi: { doi: "10.1000/dup", existing_key: "old2019" } });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("save_bib_entries", {
      entries,
      workspacePath: "/workspace",
    });
  });

  it("materializeCitation invokes materialize_citation and returns PageMeta", async () => {
    const meta = await materializeCitation("smith2020");
    expect(meta.relative_path).toBe("citations/smith2020.md");
    expect(meta.title).toContain("smith2020");
    expect(meta.file_type).toBe("markdown");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("materialize_citation", { bibKey: "smith2020" });
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

  it("getCitingPages returns citing page entries", async () => {
    const cp = await getCitingPages("smith2024");
    expect(cp).toHaveLength(1);
    expect(cp[0]!.source_id).toBe("a.md");
    expect(cp[0]!.source_line).toBe(12);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_citing_pages", { bibKey: "smith2024" });
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
    expect(result.edges[0]).toEqual(["a.md", "b.md", "wikilink"]);
    expect(result.nodes[0]!.materialization).toBe("materialized");
    expect(result.pagerank).toEqual({ "a.md": 0.4, "b.md": 0.6 });
    expect(result.positions).toEqual({});
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: ["a.md", "b.md"], depth: 1, directed: null, includeCitations: null, includeCardbox: null });
  });

  it("getFullSubgraph calls get_graph_subgraph with empty seeds", async () => {
    const result = await getFullSubgraph();
    expect(result.nodes).toHaveLength(2);
    expect(result.pagerank).toEqual({ "a.md": 0.4, "b.md": 0.6 });
    expect(result.positions).toEqual({});
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", {
      seeds: [], depth: 0, directed: null, includeCitations: null, includeCardbox: null,
    });
  });

  it("getGraphSubgraph passes includeCitations when edgeFilters.citations is true", async () => {
    await getGraphSubgraph(["a.md"], 1, false, { citations: true, cardbox: false });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", {
      seeds: ["a.md"], depth: 1, directed: false, includeCitations: true, includeCardbox: false,
    });
  });

  it("getFullSubgraph passes includeCitations when edgeFilters.citations is true", async () => {
    await getFullSubgraph({ citations: true, cardbox: false });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", {
      seeds: [], depth: 0, directed: null, includeCitations: true, includeCardbox: false,
    });
  });

  it("getBibKeyStates returns bib key state map", async () => {
    const result = await getBibKeyStates();
    expect(result.smith2024).toEqual({ materialization: "shadow", page_id: null });
    expect(result.doe2021).toEqual({ materialization: "materialized", page_id: "notes/doe2021.md" });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_bib_key_states");
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

  it("findCompanionFile resolves to companion path", async () => {
    const result = await findCompanionFile("paper.md");
    expect(result).toBe("paper.pdf");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("find_companion_file", { relativePath: "paper.md" });
  });

  it("findCompanionFile resolves to null when no companion", async () => {
    const result = await findCompanionFile("orphan.md");
    expect(result).toBeNull();
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
    const anns = await parseAnnotations("<!--- n: | a note --->");
    expect(anns).toHaveLength(1);
    expect(anns[0]!.annotation_type).toBe("note");
    expect(anns[0]!.body).toBe("a note");
    expect(anns[0]!.is_structured).toBe(true);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("parse_annotations", { content: "<!--- n: | a note --->" });
  });

  it("parseAnnotations empty content returns empty array", async () => {
    const anns = await parseAnnotations("");
    expect(anns).toHaveLength(0);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("parse_annotations", { content: "" });
  });

  it("resolveAnnotationScope returns range", async () => {
    const result = await resolveAnnotationScope(
      "hello world <!--- n: _ | note --->",
      12,
      { kind: "words", value: 1 },
      "en",
    );
    expect(result).toEqual({ start: 6, end: 11 });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("resolve_annotation_scope", {
      content: "hello world <!--- n: _ | note --->",
      charStart: 12,
      scope: { kind: "words", value: 1 },
      lang: "en",
    });
  });

  it("resolveAnnotationScope returns null when unresolvable", async () => {
    const result = await resolveAnnotationScope(
      "<!--- n: _ | note --->",
      0,
      { kind: "words", value: 1 },
      "en",
    );
    expect(result).toBeNull();
  });

  it("resolveMarkScopes batches marks and maps charStart to snake_case", async () => {
    const result = await resolveMarkScopes(
      "hello world <!--- n: _ | note --->",
      [{ charStart: 12, scope: { kind: "words", value: 1 } }],
      "en",
    );
    expect(result).toEqual([{ start: 6, end: 11 }]);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("resolve_mark_scopes", {
      content: "hello world <!--- n: _ | note --->",
      marks: [{ char_start: 12, scope: { kind: "words", value: 1 } }],
      lang: "en",
    });
  });

  it("resolveMarkScopes preserves null elements index-aligned with marks", async () => {
    const result = await resolveMarkScopes(
      "<!--- n: _ | note --->",
      [
        { charStart: 0, scope: { kind: "words", value: 1 } },
        { charStart: 12, scope: { kind: "words", value: 1 } },
      ],
      "en",
    );
    expect(result).toEqual([null, { start: 6, end: 11 }]);
  });

  it("resolveAnnotationScopeWithMode calls IPC with mode arg", async () => {
    const result = await resolveAnnotationScopeWithMode(
      "hello world <!--- llm | explain --->",
      12,
      { kind: "sentence", value: 1 },
      "en",
      "bidirectional",
    );
    expect(result).toEqual({ start: 2, end: 15 });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("resolve_annotation_scope_with_mode", {
      content: "hello world <!--- llm | explain --->",
      charStart: 12,
      scope: { kind: "sentence", value: 1 },
      lang: "en",
      mode: "bidirectional",
    });
  });

  it("resolveAnnotationScopeWithMode returns null when unresolvable", async () => {
    const result = await resolveAnnotationScopeWithMode(
      "<!--- llm | explain --->",
      0,
      { kind: "sentence", value: 1 },
      "en",
      "backward",
    );
    expect(result).toBeNull();
  });

  it("getMarkConfig returns the merged mark config", async () => {
    const config = await getMarkConfig();
    expect(config.nb!.label).toBe("nota bene");
    expect(config.nb!.icon).toBe("B");
    expect(config.crux!.before).toBe("†");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_mark_config");
  });

  it("searchAnnotations returns results", async () => {
    const results = await searchAnnotations("Silk Road");
    expect(results).toHaveLength(1);
    expect(results[0]!.node_id).toBe("a.md");
    expect(results[0]!.body).toBe("Silk Road flourished");
    expect(results[0]!.annotation_type).toBe("note");
    expect(results[0]!.uuid).toBe("test-uuid-1");
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

  it("listAllAnnotations returns all workspace annotations", async () => {
    const results = await listAllAnnotations();
    expect(results).toHaveLength(2);
    expect(results[0]!.source_page_id).toBe("a.md");
    expect(results[0]!.annotation_type).toBe("note");
    expect(results[1]!.source_page_id).toBe("b.md");
    expect(results[1]!.annotation_type).toBe("question");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("list_all_annotations", {});
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

  it("exportLkg calls export_lkg with destination, title, description", async () => {
    const summary: LkgExportSummary = await exportLkg("/tmp/graph.lkg", "My Graph", "desc");
    expect(summary.exported_count).toBe(12);
    expect(summary.destination).toBe("/tmp/graph.lkg");
    expect(summary.graph_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("export_lkg", {
      destination: "/tmp/graph.lkg",
      title: "My Graph",
      description: "desc",
    });
  });

  it("exportLkg sends null title and description when omitted", async () => {
    await exportLkg("/tmp/graph.lkg");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("export_lkg", {
      destination: "/tmp/graph.lkg",
      title: null,
      description: null,
    });
  });

  it("importLkg calls import_lkg with source and destination", async () => {
    const summary: LkgImportSummary = await importLkg("/tmp/graph.lkg", "/dest/vault");
    expect(summary.node_count).toBe(5);
    expect(summary.edge_count).toBe(3);
    expect(summary.annotation_count).toBe(2);
    expect(summary.file_count).toBe(4);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("import_lkg", {
      source: "/tmp/graph.lkg",
      destination: "/dest/vault",
    });
  });

  it("getLicenseStatus calls get_license_status", async () => {
    const status = await getLicenseStatus();
    expect(status.state).toBe("licensed");
    expect(status.licensed_to).toBe("Test User");
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

  it("LicenseStatusResponse state union accepts 'revoked'", () => {
    // Compile-level: the union must include "revoked" or this assignment fails tsc.
    const revoked: LicenseStatusResponse = { state: "revoked" };
    expect(revoked.state).toBe("revoked");
  });

  it("checkOnlineValidation action union accepts 'revoked'", () => {
    const result: OnlineValidationResult = { action: "revoked", reason: "refund" };
    expect(result.action).toBe("revoked");
  });

  it("syncLicenseMenu calls sync_license_menu with licenseState", async () => {
    await syncLicenseMenu("unlicensed");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("sync_license_menu", { licenseState: "unlicensed" });
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
        provider: "",
        context_window: null,
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
        provider: "",
        context_window: null,
      },
    });
  });

  it("llmPromptStreaming sends provider field when specified", async () => {
    await llmPromptStreaming({
      model: "claude-sonnet-4-6",
      text: "hello",
      provider: "anthropic",
    });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_prompt_streaming", {
      args: {
        model: "claude-sonnet-4-6",
        text: "hello",
        system: null,
        messages: [],
        options: {},
        base_url: null,
        provider: "anthropic",
        context_window: null,
      },
    });
  });

  it("llmPromptStreaming passes context_window when contextWindow specified", async () => {
    await llmPromptStreaming({ model: "vllm-model", text: "hello", contextWindow: 32000 });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_prompt_streaming", {
      args: {
        model: "vllm-model",
        text: "hello",
        system: null,
        messages: [],
        options: {},
        base_url: null,
        provider: "",
        context_window: 32000,
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
      provider: null,
    });
  });

  it("testLlmConnection sends null baseUrl when omitted", async () => {
    await testLlmConnection("claude-sonnet-4-6");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_test_connection", {
      model: "claude-sonnet-4-6",
      baseUrl: null,
      provider: null,
    });
  });

  it("testLlmConnection sends provider parameter", async () => {
    await testLlmConnection("gpt-4o", "https://api.example.com", "openai");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_test_connection", {
      model: "gpt-4o",
      baseUrl: "https://api.example.com",
      provider: "openai",
    });
  });

  it("llmBuildContext invokes llm_build_context with args", async () => {
    await llmBuildContext({
      nodeId: "notes/a.md",
      systemPrompt: "be helpful",
      neighborsDepth: 2,
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hi" }],
    });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_build_context", {
      args: {
        node_id: "notes/a.md",
        system_prompt: "be helpful",
        neighbors_depth: 2,
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "hi" }],
        provider: "",
        context_window: null,
      },
    });
  });

  it("llmBuildContext defaults systemPrompt to empty string", async () => {
    await llmBuildContext({
      nodeId: "notes/a.md",
      neighborsDepth: 0,
      model: "claude-sonnet-4-6",
      messages: [],
    });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_build_context", {
      args: {
        node_id: "notes/a.md",
        system_prompt: "",
        neighbors_depth: 0,
        model: "claude-sonnet-4-6",
        messages: [],
        provider: "",
        context_window: null,
      },
    });
  });

  it("llmBuildContext sends provider field when specified", async () => {
    await llmBuildContext({
      nodeId: "notes/a.md",
      neighborsDepth: 1,
      model: "gpt-4o",
      messages: [],
      provider: "openai",
    });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_build_context", {
      args: {
        node_id: "notes/a.md",
        system_prompt: "",
        neighbors_depth: 1,
        model: "gpt-4o",
        messages: [],
        provider: "openai",
        context_window: null,
      },
    });
  });

  it("llmBuildContext passes context_window when contextWindow specified", async () => {
    await llmBuildContext({
      nodeId: "notes/a.md",
      neighborsDepth: 1,
      model: "vllm-model",
      messages: [],
      contextWindow: 64000,
    });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_build_context", {
      args: {
        node_id: "notes/a.md",
        system_prompt: "",
        neighbors_depth: 1,
        model: "vllm-model",
        messages: [],
        provider: "",
        context_window: 64000,
      },
    });
  });

  it("llmBuildContext returns BuiltContext shape", async () => {
    const result = await llmBuildContext({
      nodeId: "notes/a.md",
      systemPrompt: "test system",
      neighborsDepth: 1,
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hello" }],
      provider: "anthropic",
    });
    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("messages");
    expect(result).toHaveProperty("truncation");
    expect(result.system).toBe("test system");
    expect(result.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(result.truncation).toBeNull();
  });

  it("trashPage calls trash_page with relativePath", async () => {
    await trashPage("Doomed.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("trash_page", { relativePath: "Doomed.md" });
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

  it("executeSplit invokes execute_split and returns paths", async () => {
    const paths = await executeSplit("Doc.md");
    expect(paths).toEqual(["Alpha.md", "Beta.md"]);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("execute_split", { relativePath: "Doc.md" });
  });

  it("suggestMergeTitle returns null on failure", async () => {
    const result = await suggestMergeTitle(["A", "B"], "merged body");
    expect(result).toBeNull();
  });

  it("cancelTitleSuggestion resolves without error", async () => {
    await expect(cancelTitleSuggestion()).resolves.toBeUndefined();
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

  it("annotationFindUuid invokes with correct args", async () => {
    const uuid = await annotationFindUuid("a.md", "question", "What?", 10);
    expect(uuid).toBe("test-uuid-abc");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("annotation_find_uuid", {
      nodeId: "a.md",
      annotationType: "question",
      body: "What?",
      charStartHint: 10,
    });
  });

  it("annotationFindUuid passes null body", async () => {
    const uuid = await annotationFindUuid("a.md", "note", null, 0);
    expect(uuid).toBe("uuid-for-null-body");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("annotation_find_uuid", {
      nodeId: "a.md",
      annotationType: "note",
      body: null,
      charStartHint: 0,
    });
  });

  it("detectPandoc calls detect_pandoc", async () => {
    const info = await detectPandoc();
    expect(info.pandoc_path).toBe("/usr/local/bin/pandoc");
    expect(info.pandoc_version).toBe("pandoc 3.1.9");
    expect(info.crossref_path).toBe("/usr/local/bin/pandoc-crossref");
    expect(info.crossref_version).toBe("pandoc-crossref 0.3.17.0");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("detect_pandoc");
  });

  it("exportDocument calls export_document with snake_case request", async () => {
    const result = await exportDocument({
      relativePath: "notes/paper.md",
      outputPath: "/tmp/output.tex",
      format: "latex",
    });
    expect(result.output_path).toBe("/tmp/output.tex");
    expect(result.success).toBe(true);
    expect(result.stderr).toBe("");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("export_document", {
      request: {
        relative_path: "notes/paper.md",
        output_path: "/tmp/output.tex",
        format: "latex",
        csl: undefined,
        template: undefined,
        reference_doc: undefined,
      },
    });
  });

  it("exportDocument passes optional override fields", async () => {
    await exportDocument({
      relativePath: "paper.md",
      outputPath: "/out.tex",
      format: "latex",
      csl: "ieee",
      template: "/t.tex",
      referenceDoc: "/r.docx",
    });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("export_document", {
      request: {
        relative_path: "paper.md",
        output_path: "/out.tex",
        format: "latex",
        csl: "ieee",
        template: "/t.tex",
        reference_doc: "/r.docx",
      },
    });
  });

  it("autoUnlockSecretStore invokes auto_unlock_secret_store", async () => {
    const result = await autoUnlockSecretStore();
    expect(result).toBe(true);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("auto_unlock_secret_store");
  });

  it("migrateSecretStore invokes migrate_secret_store with oldPassphrase", async () => {
    await migrateSecretStore("old-pass");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("migrate_secret_store", { oldPassphrase: "old-pass" });
  });

  it("secretStoreStatus returns SecretStoreStatus with exists and unlocked", async () => {
    const status: SecretStoreStatus = await secretStoreStatus();
    expect(status.exists).toBe(true);
    expect(status.unlocked).toBe(true);
    expect(Object.keys(status).sort()).toEqual(["exists", "unlocked"]);
    expect("needsMigration" in status).toBe(false);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("secret_store_status");
  });

  it("enrichBibEntry calls enrich_bib_entry with bibKey and workspacePath", async () => {
    const result: EnrichResult = await enrichBibEntry("smith2020", "/workspace");
    expect(result.entry.key).toBe("smith2020");
    expect(result.fields_added).toEqual(["abstract", "journal"]);
    expect(result.references_found).toBe(5);
    expect(result.references_appended).toBe(5);
    expect(result.shadow_nodes_created).toBe(3);
    expect(result.references_linked).toBe(5);
    expect(result.candidates).toEqual([]);
    expect(result.providers_searched).toEqual([]);
    expect(result.providers_failed).toEqual([]);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("enrich_bib_entry", {
      bibKey: "smith2020",
      workspacePath: "/workspace",
    });
  });

  it("applyEnrichmentCandidate calls apply_enrichment_candidate with bibKey, candidate, and workspacePath", async () => {
    const candidate = {
      key: "candidate2020",
      authors: ["Doe, Jane"],
      title: "Candidate Paper",
      year: "2020",
      entry_type: "article",
      line_number: 0,
      doi: "10.1/candidate-doi",
      journal: "Science",
      abstract_text: "Candidate abstract",
    };
    const result: EnrichResult = await applyEnrichmentCandidate("smith2020", candidate, "/workspace");
    expect(result.entry.key).toBe("smith2020");
    expect(result.fields_added).toEqual(["doi", "journal", "abstract"]);
    expect(result.references_found).toBe(3);
    expect(result.references_appended).toBe(3);
    expect(result.shadow_nodes_created).toBe(2);
    expect(result.references_linked).toBe(3);
    expect(result.candidates).toEqual([]);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("apply_enrichment_candidate", {
      bibKey: "smith2020",
      candidate,
      workspacePath: "/workspace",
    });
  });

  it("downloadEntryPdf calls download_entry_pdf with key and workspacePath", async () => {
    const result = await downloadEntryPdf("smith2020", "/workspace");
    expect(result).toBe("assets/pdf/smith2020.pdf");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("download_entry_pdf", {
      key: "smith2020",
      workspacePath: "/workspace",
    });
  });

  it("linkEntryPdf calls link_entry_pdf with key, filePath, and workspacePath", async () => {
    const result = await linkEntryPdf("smith2020", "/tmp/paper.pdf", "/workspace");
    expect(result).toBe("assets/pdf/smith2020.pdf");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("link_entry_pdf", {
      key: "smith2020",
      filePath: "/tmp/paper.pdf",
      workspacePath: "/workspace",
    });
  });

  it("OcrProgressPayload type is usable", () => {
    const payload: OcrProgressPayload = { key: "smith2020", step: "extracting" };
    expect(payload.key).toBe("smith2020");
    expect(payload.step).toBe("extracting");
    expect(payload.detail).toBeUndefined();
  });

  it("ocrPdfToMarkdown calls ocr_pdf_to_markdown with defaults", async () => {
    const result = await ocrPdfToMarkdown("smith2020", "/workspace");
    expect(result).toBe("smith2020.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("ocr_pdf_to_markdown", {
      key: "smith2020",
      workspacePath: "/workspace",
      lead: 0,
      trail: 0,
      overwrite: false,
    });
  });

  it("ocrPdfToMarkdown forwards custom options", async () => {
    await ocrPdfToMarkdown("smith2020", "/workspace", { lead: 2, trail: 3, overwrite: true });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("ocr_pdf_to_markdown", {
      key: "smith2020",
      workspacePath: "/workspace",
      lead: 2,
      trail: 3,
      overwrite: true,
    });
  });

  it("checkOcrTargetExists calls check_ocr_target_exists", async () => {
    const result = await checkOcrTargetExists("smith2020", "A Test Paper", "/workspace");
    expect(result).toBe(false);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("check_ocr_target_exists", {
      key: "smith2020",
      title: "A Test Paper",
      workspacePath: "/workspace",
    });
  });

  it("isOcrCompanionCurrent calls is_ocr_companion_current", async () => {
    const result = await isOcrCompanionCurrent("smith2020", "A Test Paper", "/workspace", "assets/pdf/smith2020.pdf");
    expect(result).toBe("test-paper.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("is_ocr_companion_current", {
      key: "smith2020",
      title: "A Test Paper",
      workspacePath: "/workspace",
      pdfRelative: "assets/pdf/smith2020.pdf",
    });
  });

  it("recognizePdf calls recognize_pdf with correct args", async () => {
    const result: RecognizeResult = await recognizePdf(
      "/external/paper.pdf",
      "/workspace",
    );
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.outcome).toEqual({ Saved: { key: "kucsko2013" } });
      expect(result.source).toBe("DoiContentNegotiation");
      expect(result.validation).toBe("validated");
      expect(result.file).toBe("assets/pdf/paper.pdf");
      expect(result.entry.key).toBe("kucsko2013");
      expect(result.entry.file).toBe("assets/pdf/paper.pdf");
    }
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("recognize_pdf", {
      pdfPath: "/external/paper.pdf",
      workspacePath: "/workspace",
    });
  });

  it("recognizePdf handles needs_confirmation result", async () => {
    mockInvoke((cmd) => {
      if (cmd === "recognize_pdf") {
        return {
          kind: "needs_confirmation",
          reason: "no_text_layer",
          prefilled: {
            key: "",
            authors: [],
            title: "",
            year: "",
            entry_type: "misc",
            line_number: 0,
            file: "assets/pdf/scanned.pdf",
          },
          file: "assets/pdf/scanned.pdf",
          message: null,
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
    const result = await recognizePdf(
      "/external/scanned.pdf",
      "/workspace",
    );
    expect(result.kind).toBe("needs_confirmation");
    if (result.kind === "needs_confirmation") {
      const reason: ConfirmReason = result.reason;
      expect(reason).toBe("no_text_layer");
      expect(result.prefilled.entry_type).toBe("misc");
      expect(result.file).toBe("assets/pdf/scanned.pdf");
      expect(result.message).toBeNull();
    }
  });

  // SaveOutcome type guards
  it("isSaved returns true for Saved variant", () => {
    const o: SaveOutcome = { Saved: { key: "k" } };
    expect(isSaved(o)).toBe(true);
  });

  it("isSaved returns false for DuplicateDoi variant", () => {
    const o: SaveOutcome = { DuplicateDoi: { doi: "10.1/x", existing_key: "k" } };
    expect(isSaved(o)).toBe(false);
  });

  it("isDuplicateDoi returns true for DuplicateDoi variant", () => {
    const o: SaveOutcome = { DuplicateDoi: { doi: "10.1/x", existing_key: "k" } };
    expect(isDuplicateDoi(o)).toBe(true);
  });

  it("isSavedNoDoi returns true for SavedNoDoi variant", () => {
    const o: SaveOutcome = { SavedNoDoi: { key: "k" } };
    expect(isSavedNoDoi(o)).toBe(true);
  });

  it("importRecognizedEntry calls import_recognized_entry with correct args", async () => {
    const entry = {
      key: "",
      authors: ["Manual, Author"],
      title: "Manual Entry",
      year: "2024",
      entry_type: "misc",
      line_number: 0,
      file: "assets/pdf/paper.pdf",
    };
    const outcomes = await importRecognizedEntry(
      entry,
      "/workspace",
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual({ Saved: { key: "manual2024" } });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("import_recognized_entry", {
      entry,
      workspacePath: "/workspace",
    });
  });

  // ── New DB-backed bib commands ─────────────────────────────────

  it("bibSearch calls bib_search with query and limit", async () => {
    const results = await bibSearch("Smith", 10, "/workspace");
    expect(results).toHaveLength(1);
    expect(results[0]!.key).toBe("smith2020");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("bib_search", {
      query: "Smith",
      limit: 10,
      workspacePath: "/workspace",
    });
  });

  it("bibGet calls bib_get and returns entry", async () => {
    const result = await bibGet("smith2020", "/workspace");
    expect(result).not.toBeNull();
    expect(result!.key).toBe("smith2020");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("bib_get", {
      citeKey: "smith2020",
      workspacePath: "/workspace",
    });
  });

  it("bibGet returns null for missing key", async () => {
    const result = await bibGet("nonexistent", "/workspace");
    expect(result).toBeNull();
  });

  it("bibUpdateFields calls bib_update_fields and returns boolean", async () => {
    const result = await bibUpdateFields("smith2020", { title: "New" }, "/workspace");
    expect(result).toBe(true);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("bib_update_fields", {
      citeKey: "smith2020",
      fields: { title: "New" },
      workspacePath: "/workspace",
    });
  });

  it("bibDelete calls bib_delete and returns boolean", async () => {
    const result = await bibDelete("smith2020", "/workspace");
    expect(result).toBe(true);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("bib_delete", {
      citeKey: "smith2020",
      workspacePath: "/workspace",
    });
  });

  it("getReferences calls get_references and returns entries", async () => {
    const result = await getReferences("parent2024", "/workspace");
    expect(result).toHaveLength(2);
    expect(result[0]!.key).toBe("ref_alpha2020");
    expect(result[1]!.key).toBe("ref_beta2021");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_references", {
      bibKey: "parent2024",
      workspacePath: "/workspace",
    });
  });

  it("getReferences returns empty array when no references", async () => {
    const result = await getReferences("empty_refs", "/workspace");
    expect(result).toEqual([]);
  });

  it("getReferenceCounts returns reference count map", async () => {
    const result = await getReferenceCounts("/workspace");
    expect(result).toEqual({ parent2024: 3, smith2020: 1 });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("get_reference_counts", {
      workspacePath: "/workspace",
    });
  });

  it("ensureInCompanionBib calls ensure_in_companion_bib and returns result", async () => {
    const result = await ensureInCompanionBib("smith2020", "Note.md", "/workspace");
    expect(result).toEqual({ bib_path: "assets/bib/Note.bib", bibliography_value: null });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("ensure_in_companion_bib", {
      citeKey: "smith2020",
      notePath: "Note.md",
      workspacePath: "/workspace",
      skipNoteRewrite: false,
    });
  });

  it("ensureInCompanionBib sends skipNoteRewrite when true", async () => {
    const result = await ensureInCompanionBib("smith2020", "Note.md", "/workspace", true);
    expect(result).toEqual({ bib_path: "assets/bib/Note.bib", bibliography_value: null });
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("ensure_in_companion_bib", {
      citeKey: "smith2020",
      notePath: "Note.md",
      workspacePath: "/workspace",
      skipNoteRewrite: true,
    });
  });

  // ── Cardbox group IPC wrappers ────────────────────────────────

  it("createCardboxGroup calls create_cardbox_group with correct args", async () => {
    await createCardboxGroup("g1", "My Group", ["u1", "u2"], "u3");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("create_cardbox_group", {
      groupId: "g1",
      name: "My Group",
      cardUuids: ["u1", "u2"],
      afterEntry: "u3",
    });
  });

  it("createCardboxGroup sends null afterEntry when omitted", async () => {
    await createCardboxGroup("g1", "My Group", ["u1"]);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("create_cardbox_group", {
      groupId: "g1",
      name: "My Group",
      cardUuids: ["u1"],
      afterEntry: null,
    });
  });

  it("renameCardboxGroup calls rename_cardbox_group", async () => {
    await renameCardboxGroup("g1", "New Name");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("rename_cardbox_group", {
      groupId: "g1",
      name: "New Name",
    });
  });

  it("dissolveCardboxGroup calls dissolve_cardbox_group", async () => {
    await dissolveCardboxGroup("g1");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("dissolve_cardbox_group", {
      groupId: "g1",
    });
  });

  it("moveCardToGroup calls move_card_to_group with correct args", async () => {
    await moveCardToGroup("u1", "g1", 2);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("move_card_to_group", {
      cardUuid: "u1",
      targetGroupId: "g1",
      index: 2,
    });
  });

  it("moveCardToGroup sends null index when omitted", async () => {
    await moveCardToGroup("u1", "g1");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("move_card_to_group", {
      cardUuid: "u1",
      targetGroupId: "g1",
      index: null,
    });
  });

  it("removeCardFromGroup calls remove_card_from_group with correct args", async () => {
    await removeCardFromGroup("u1", "g1", 0);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("remove_card_from_group", {
      cardUuid: "u1",
      groupId: "g1",
      topLevelIndex: 0,
    });
  });

  it("removeCardFromGroup sends null topLevelIndex when omitted", async () => {
    await removeCardFromGroup("u1", "g1");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("remove_card_from_group", {
      cardUuid: "u1",
      groupId: "g1",
      topLevelIndex: null,
    });
  });

  it("toggleGroupCollapsed calls toggle_group_collapsed", async () => {
    await toggleGroupCollapsed("g1", true);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("toggle_group_collapsed", {
      groupId: "g1",
      collapsed: true,
    });
  });

  // ── Cardbox pin IPC wrappers ───────────────────────────────────

  it("pinCardboxCard calls pin_cardbox_card", async () => {
    await pinCardboxCard("u1");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("pin_cardbox_card", { uuid: "u1" });
  });

  it("unpinCardboxCard calls unpin_cardbox_card", async () => {
    await unpinCardboxCard("u1");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("unpin_cardbox_card", { uuid: "u1" });
  });

  // ── Card note (slip) IPC wrappers ─────────────────────────────

  it("setCardNote calls set_card_note with uuid and body", async () => {
    await setCardNote("u1", "My note content");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("set_card_note", {
      uuid: "u1",
      body: "My note content",
    });
  });

  it("clearCardNote calls clear_card_note", async () => {
    await clearCardNote("u1");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("clear_card_note", { uuid: "u1" });
  });

  it("exportCardNote calls export_card_note and returns markdown", async () => {
    const result = await exportCardNote("u1");
    expect(result).toBe("Note on Test.md");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("export_card_note", { uuid: "u1" });
  });

  // ── Color tag IPC wrappers ────────────────────────────────────

  it("setCardColor calls set_card_color", async () => {
    await setCardColor("u1", "blue");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("set_card_color", {
      uuid: "u1",
      color: "blue",
    });
  });

  it("clearCardColor calls clear_card_color", async () => {
    await clearCardColor("u1");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("clear_card_color", {
      uuid: "u1",
    });
  });

  // ── Search provider IPC wrappers ────────────────────────────────

  it("listSearchProviders calls list_search_providers", async () => {
    const result = await listSearchProviders();
    expect(result).toBeInstanceOf(Array);
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("list_search_providers");
  });

});
