# Lit — Roadmap

A local-first outliner with bidirectional linking, built with Rust/Tauri and React/TypeScript.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Tauri 2 | Rust backend, native webview, small binary |
| Frontend | React 18 + TypeScript + Vite | Fast dev loop, strong typing |
| Editor | TipTap (ProseMirror) | Block editing, markdown serde, Yjs collab adapter |
| State | Zustand | Minimal, no boilerplate |
| Styling | Tailwind CSS | Utility-first, fast iteration |
| Storage | Markdown files on disk | Interop, human-readable, git-friendly |
| Markdown parse | pulldown-cmark (Rust) | Fast, CommonMark-compliant, streaming |
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

**Status:** Complete (2026-04-20). See [[stage-0-bootstrap]] for full implementation details.

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
- **Obsidian:** Vault chooser on first launch — opening the app means opening a folder of files, identical philosophy to Lit's workspace concept.

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
- [ ] Parse markdown into a block tree (deferred to Stage 2)

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

## Stage 2 — Outliner Block Editor

**Goal:** Edit pages as an indented block tree with Obsidian-style mode switching.

### Block data model

- A page is a tree of blocks. Each block holds a markdown string + children.
- Serialize to markdown as nested bullet lists (`- ` with 2-space indent).
- Blocks carry a transient ID (stable within a session, regenerated on load).

### TipTap editor

- Custom TipTap node type: `OutlinerBlock` (content: inline markdown, children: nested `OutlinerBlock` list).
- **Edit mode:** focused block shows as editable markdown (TipTap inline editing with markdown input rules — bold, italic, code, links).
- **Preview mode:** all blocks render as formatted rich text (TipTap read-only mode with markdown decorations).
- Mode toggle: per-page, keyboard shortcut (`Ctrl/Cmd+E`).
- Esc in edit mode → current block exits edit mode and renders as preview (analogous to Vim's Esc from insert mode). Focus stays on the block but it becomes read-only rendered markdown. Press Enter or click to re-enter edit mode.

### Outliner operations

- Enter → new sibling block below
- Backspace at start → merge with previous block
- Tab → indent (become child of previous sibling)
- Shift+Tab → outdent (become next sibling of parent)
- Esc → exit edit mode for current block (render as preview)
- Block folding/collapsing (toggle children visibility)
- Drag-and-drop reorder
- Multi-block selection + indent/outdent/delete
- Undo/redo (per-page)

### Persistence

- On edit: debounced write-back to `.md` file via Tauri command (300ms after last keystroke)
- On external change: re-parse and merge (or prompt if conflicts)

**Deliverable:** Full outliner editing with keyboard-driven block manipulation and Obsidian-like edit/preview toggle. Changes persist as clean markdown.

---

## Stage 3 — Bidirectional Linking

**Goal:** `[[Page Name]]` references create navigable, queryable links between pages.

### Parsing

- Rust: extract `[[...]]` references during markdown parse, build an in-memory link index (page → set of pages it links to, page → set of pages that link to it).
- Index rebuilt on startup, updated incrementally on page save.

### Frontend — inline links

- TipTap extension: `PageReference` inline node.
- In edit mode: `[[` triggers autocomplete dropdown (fuzzy match on page names).
- In preview mode: rendered as clickable link, navigates to target page.
- Clicking a reference to a non-existent page creates it.

### Frontend — backlinks panel

- Bottom of page: collapsible "Linked References" section.
- Shows every block from other pages that references the current page, with surrounding context.
- Click a backlink to navigate to its source page and scroll to the block.

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
- Each page's block tree maps to a Yjs `Y.XmlFragment` (or `Y.Array` of `Y.Map` blocks).
- On connection: exchange full document state vectors, sync deltas.
- On edit: broadcast incremental Yjs updates to connected peers.
- On receive: apply remote updates, TipTap re-renders via y-tiptap binding.
- Offline edits merge automatically when peers reconnect.

### Phase 4c — Presence

- Broadcast cursor position and active page to peers.
- Show colored cursors / highlights for remote collaborators.
- Sidebar shows who is connected and which page they are viewing.

**Deliverable:** Open Lit on two laptops on the same Wi-Fi. Both see each other, open the same workspace, and co-edit blocks in real time with live cursors. No server, no internet required.

---

## Future Stages (to be scoped later)

These are listed for architectural awareness — they should not constrain current work, but current designs should not make them impossible, e.g.

- Agent-in-residence (AIR): a companion in-memory AI agent closely offer real-time assistance. Such a built-in tool offers synergy over have to use Claud Code with Obsidian.
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
4. **Blocks are the atom.** The fundamental unit is a block (a markdown bullet), not a page. Pages are containers.
5. **CRDTs from day one of collab.** No OT, no last-write-wins. Yjs/yrs everywhere sync touches data.
