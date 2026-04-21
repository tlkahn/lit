# Lit — Roadmap

A local-first outliner with bidirectional linking, built with Rust/Tauri and React/TypeScript.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Tauri 2 | Rust backend, native webview, small binary |
| Frontend | React 18 + TypeScript + Vite | Fast dev loop, strong typing |
| Editor | CodeMirror 6 | Incremental parsing, live preview decorations, near-native speed, Yjs collab adapter |
| State | Zustand | Minimal, no boilerplate |
| Styling | Tailwind CSS | Utility-first, fast iteration |
| Storage | Markdown files on disk | Interop, human-readable, git-friendly |
| Markdown parse | @lezer/markdown (JS) + pulldown-cmark (Rust) | Lezer for live editor syntax tree; pulldown-cmark for Rust-side indexing |
| File watch | notify (Rust) | Cross-platform fs events |
| Future Datalog | Cozo (Rust) | Embeddable Datalog DB, SQLite-backed, closest to DataScript |
| CRDT | Yjs + yrs | Proven collaborative editing, JS and Rust implementations share the same protocol |
| Local collab | mdns-sd (Rust) | Bonjour/mDNS service discovery for LAN peers |

## Principles

- Unix philosophy: each piece does one thing well.
- Markdown files are the source of truth. No proprietary format.
- Offline-first. Network features are additive, never required.
- Fast startup, low memory. A note app should feel instant.
- Keyboard-driven, mouse-optional.

---

## Stage 0 — Project Bootstrap ✅

**Status:** Complete (2026-04-20). See [[implementation/stage-0-bootstrap]] for full implementation details.

**Goal:** Empty app runs, dev toolchain works end-to-end.

- [x] Tauri 2 + Vite + React + TypeScript project scaffold
- [x] Tailwind CSS v4 + base theme (light/dark with system detection and manual toggle)
- [x] Basic window: sidebar (page list) + main content area, with configurable sidebar position (left/right)
- [x] Tauri IPC plumbing: `get_app_info()` round-trip proving Rust ↔ JS works
- [x] CI: GitHub Actions with parallel `cargo check`/`cargo test` and `vitest`/`eslint`/`tsc --noEmit` jobs
- [x] README with dev setup instructions
- [x] 16 tests total (15 vitest + 1 cargo) — all passing

### Feature References
- **Logseq:** Sidebar + main content split layout; Electron shell pattern (Lit uses Tauri instead for smaller binaries and a Rust backend).
- **Obsidian:** Vault chooser on first launch — opening the app means opening a folder of files, identical philosophy to Lit's **workspace** concept.

**Deliverable:** `bun tauri dev` opens a window with sidebar, content pane, theme toggle, sidebar position toggle, and "Lit v0.1.0".

---

## Stage 1 — Markdown File Backend ✅

**Status:** Complete (2026-04-20).

**Goal:** Read and write a directory of markdown files as pages.

### Rust side

- [x] **Workspace** abstraction: a directory containing `.md` files (one file = one page)
- [x] Read all `.md` files, expose page list via Tauri command (`scan_pages`, `list_pages`)
- [x] Read single page content, write page content (`read_page`, `write_page`)
- [x] File watcher (notify crate): detect external changes, push events to frontend
- [x] Create / rename / delete page (`create_page`, `rename_page`, `delete_page`)
- [x] YAML frontmatter parsing (gray_matter + serde_yaml, Obsidian-compatible)
- [x] NFC Unicode normalization for filenames
- [x] CLI argument support: `bun tauri dev -- -- /path/to/workspace`
- [x] ~~Parse markdown into a block tree~~ → superseded: Stage 2 uses CM6's flat document model with Lezer incremental parsing instead

### Frontend

- [x] Sidebar: list pages with collapsible folder tree, create new page, search/filter
- [x] Click page to load content into main pane (raw markdown textarea)
- [x] Create / rename / delete page via UI (context menu)
- [x] Handle file-watcher events: reload content when file changes externally
- [x] Workspace chooser: native folder picker on first launch
- [x] Auto-reopen last workspace from localStorage
- [x] Zustand workspace store for state management
- [x] Debounced write-back (300ms) on edits
- [x] 72 tests total (37 cargo + 35 vitest) — all passing

**Deliverable:** Browse, create, edit, and delete markdown pages. External edits (e.g. from vim) reflect in the app within a second.

---

## Stage 2 — CodeMirror 6 Live Preview Editor

**Goal:** Replace the raw textarea with a high-performance CodeMirror 6 editor featuring Obsidian-style live preview — formatted output rendered inline, raw markdown syntax revealed near the cursor. Editing speed should rival native editors (Sublime Text, Zed).

**Architecture:** CodeMirror 6 owns the live document model and all editing. The editor operates on raw markdown text — no block tree, no intermediate AST in the editing path. Lezer-based incremental parsing drives syntax highlighting and live preview decorations. Rust handles file I/O only during editing; Rust re-parses saved files in the background for link indexing, search, and metadata extraction (pulldown-cmark). This keeps the editing loop entirely in JS (zero IPC latency per keystroke) while Rust provides the knowledge layer.

**Decisions:** flat document model (not block-based), live preview via CM6 decoration plugins (not separate edit/preview modes), `@lezer/markdown` with custom extensions for Obsidian syntax, TDD throughout.

#### A1 — CM6 Foundation ✅

- [x] Replace `<textarea>` in ContentArea with a React-wrapped CodeMirror 6 component
- [x] Markdown language support via `@codemirror/lang-markdown` + `@lezer/markdown`
- [x] Basic syntax highlighting: headings, emphasis, links, images, ordered/unordered/task lists, code spans, fenced code blocks, horizontal rules, blockquotes
- [x] CM6 theme (EditorTheme) for light and dark modes, matching existing Tailwind design tokens
- [x] Wire load/save to existing Rust IPC (`read_page` / `write_page`)

#### A2 — Live Preview Decoration Engine ✅

- [x] ViewPlugin-based decoration system: replace raw syntax with rendered output for non-cursor regions
- [x] Styled headings (font size/weight applied inline), bold/italic rendered (syntax markers hidden)
- [x] Links rendered as clickable text (URL hidden), images rendered as inline previews
- [x] Cursor proximity detection: reveal raw syntax within N characters of cursor position
- [x] Fenced code blocks with per-language syntax highlighting via `@codemirror/language-data`

#### A3 — Obsidian Markdown Extensions

- Custom Lezer markdown extensions: `[[wikilinks]]`, ~~`#tags`~~ (in-page implementation no longer required. `tags` should only be set in the document frontmatter. Roadmap doc to be updated.)
- Callout rendering (`> [!type]`) with styled containers. Supported callout types (with aliases):
    - note, abstract/summary/tldr, info, todo, tip/hint/important,
    - success/check/done, question/help/faq, warning/caution/attention,
    - failure/fail/missing, danger/error, bug, example, quote/cite
- YAML frontmatter block: syntax highlighting and visual separation
- Math rendering: `$inline$` and `$$display$$` via KaTeX widget decorations

> [!note]
> 1. Callout fold doesn't work.
> 2. Latex in callouts doesn't render.
> 3. A few fixture examples have errors (thus cannot render).

#### A4 — Mermaid Diagram Rendering

- Detect ` ```mermaid ` fenced code blocks via Lezer syntax tree
- Render diagrams inline as widget decorations using Mermaid.js (lazy-loaded for bundle size)
- Live preview behavior: cursor inside the code block shows raw Mermaid source, cursor outside shows the rendered SVG diagram
- Error handling: display Mermaid parse errors inline below the code block instead of a broken diagram
- Dark mode support: pass current theme to Mermaid's `theme` config (`default` / `dark`)

#### B1 — Auto-Save + File Sync

- Debounced auto-save: `EditorView.updateListener` → 300ms idle → invoke Rust `write_page`
- External change handling: file watcher events trigger CM6 state update (with conflict detection when local buffer is dirty)
- Scroll position preservation: save/restore per page in Zustand store across page switches

#### B2 — Editing Shortcuts + Folding + Performance

- Markdown editing shortcuts: Cmd+B (bold), Cmd+I (italic), Cmd+K (insert link), Cmd+/ (toggle comment)
- List-aware keyboard behavior: Enter continues list item, Tab/Shift+Tab indent/outdent in lists, Backspace at list start unindents
- Search & replace via CM6 built-in panel (`@codemirror/search`)
- Section folding: heading-based folds, code block folds, frontmatter fold (CM6 fold extension + custom fold providers)
- Performance validation with large files (1000+ lines, target <16ms keystroke latency)

### Phase C — Document Navigation

- Heading outline panel: extract headings from CM6 syntax tree, render in sidebar, click to scroll
- Breadcrumb bar showing current heading context as cursor moves
- Cmd+G go-to-heading quick switcher (fuzzy match within current document)

**Deliverable:** A fast, Obsidian-style live preview editor with full markdown syntax support (including Mermaid diagrams), auto-save, file sync, folding, and document navigation. Changes persist as clean markdown. No block tree — the markdown file is edited directly.

> [!note]-
> wikilinks are not rendered properly (double brackets still visible. mouse shape on hover not changed)
> turboref support
> Extra: 
> - use oxide LSP for edit features like autocomplete, go to definition/references etc. Potential Phase D.
> - use an iAwriter like theme by default
> - Support Obsidian theme plugin
> - bug: in dark them, when the edit view is long enough to be viewable through scolling down, the revealed portion of the side bar will show as white background 
> - Core feature: awesome and best-in-place multi-language and font support, e.g. indic languages (devanagari, śarada, tibetan), CJK, arabic, etc.

---

## Stage 3 — Bidirectional Linking

**Goal:** `[[Page Name]]` references create navigable, queryable links between pages.

### Parsing

- Rust: extract `[[...]]` references during markdown parse, build an in-memory link index (page → set of pages it links to, page → set of pages that link to it).
- Index rebuilt on startup, updated incrementally on page save.

### Frontend — inline links

- CM6 extension: wikilink autocomplete + navigation (builds on the `[[wikilink]]` Lezer extension from Stage 2).
- Typing `[[` triggers autocomplete dropdown (fuzzy match on page names from Rust link index).
- In live preview: rendered as clickable link, navigates to target page.
- Clicking a reference to a non-existent page creates it.

### Frontend — backlinks panel

- Bottom of page: collapsible "Linked References" section.
- Shows every paragraph/section from other pages that references the current page, with surrounding context.
- Click a backlink to navigate to its source page and scroll to the relevant position.

### Frontend — unlinked references (stretch)

- Detect mentions of the current page name in other pages that are not wrapped in `[[...]]`.
- Offer a button to convert to a proper link.

**Deliverable:** Pages are interconnected. Typing `[[` and a few characters links to any page. Backlinks let you discover connections you didn't explicitly navigate.

---

## Stage 4 — Local Network Collaboration (Bonjour/mDNS)

**Goal:** Two Lit instances on the same LAN can co-edit a shared workspace in real time, SubEthaEdit-style.

### Phase 4a — Discovery & Connection

- Rust: advertise workspace via mDNS (`_lit._tcp.local.`) using mdns-sd crate.
- Rust: discover other Lit instances on LAN, present in sidebar ("Nearby" section).
- User clicks a peer → establishes WebSocket connection (Rust ↔ Rust, via Tauri's localhost server or direct TCP).
- Auth: simple shared-secret or trust-on-first-use (like SSH).

### Phase 4b — CRDT Document Sync

- Integrate yrs (Rust Yjs) as the sync backend.
- Each page maps to a Yjs `Y.Text` document (flat text model, matching CM6's document model).
- On connection: exchange full document state vectors, sync deltas.
- On edit: broadcast incremental Yjs updates to connected peers.
- On receive: apply remote updates, CM6 re-renders via y-codemirror binding.
- Offline edits merge automatically when peers reconnect.

### Phase 4c — Presence

- Broadcast cursor position and active page to peers.
- Show colored cursors / highlights for remote collaborators.
- Sidebar shows who is connected and which page they are viewing.

**Deliverable:** Open Lit on two laptops on the same Wi-Fi. Both see each other, open the same workspace, and co-edit documents in real time with live cursors. No server, no internet required.

---

## Future Stages (to be scoped later)

These are listed for architectural awareness — they should not constrain current work, but current designs should not make them impossible, e.g.

- Agent-in-residence (AIR): a companion in-memory AI agent closely offer real-time assistance. Such a built-in tool offers synergy over have to use Claud Code with Obsidian.
- Obsidian-like graph view (using D3.js for mature force field visual effects, rather than fresh homebrew).
- Zotero-like bibliograph management

| Stage | Feature | Notes |
|---|---|---|
| 5 | Daily journals | Auto-create today's page, calendar navigation |
| 6 | Full-text search | Rust-side index (tantivy crate), instant results |
| 7 | Block references & embeds | `((block-id))` transclusion |
| 8 | Tags and properties | YAML frontmatter, inline `key:: value` properties |
| 9 | Queries | Structured queries over properties/tags, rendered as live tables |
| 10 | Graph visualization | Force-directed graph of page links (d3-force or GPU-based) |
| 11 | Theming & customization | Custom CSS, configurable keybindings |
| 12 | Cloud sync | End-to-end encrypted sync via relay server, CRDTs already in place from Stage 4 |
| 13 | Templates & slash commands | `/template`, `/date`, `/todo` |
| 14 | Plugin system | WASM-based sandboxed plugins (extism or similar) |
| 15 | Mobile | Tauri mobile targets (iOS/Android) |

---

## Architectural Invariants

These hold across all stages:

1. **Markdown is canon.** The `.md` file is always the source of truth. Any index or cache is derived and rebuildable.
2. **Rust owns data, JS owns pixels.** File I/O, parsing, indexing, sync — all in Rust. The frontend is a view layer.
3. **No implicit network.** Every network operation (LAN discovery, future cloud sync) is opt-in and visible to the user.
4. **Text is the atom.** The fundamental unit is the raw markdown text, not a block AST. The editor operates on text directly; structure (headings, lists, links) is derived by incremental parsing, never imposed.
5. **CRDTs from day one of collab.** No OT, no last-write-wins. Yjs/yrs everywhere sync touches data.
