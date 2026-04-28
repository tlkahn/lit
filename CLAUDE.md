# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Lit

Local-first notetaker and knowledge graph manager. Tauri 2 desktop app — Rust backend, React/TypeScript frontend.

## Quick Reference

```bash
bun install                          # install frontend deps
bun tauri dev                        # run the full app (frontend + Rust)
bun run test                         # vitest (uses `bunx vitest run`, NOT `bun test`)
bun run test:watch                   # vitest watch mode
bun run test -- src/lib/ipc.test.ts  # run a single test file
bun run bench                        # vitest benchmarks
bun run lint                         # eslint
bun run typecheck                    # tsc --noEmit
cd src-tauri && cargo test           # rust tests
cd src-tauri && cargo test page      # run rust tests matching "page"
```

## Architecture

- **Rust owns data, JS owns pixels.** File I/O, parsing, indexing — Rust. UI rendering — React.
- **IPC boundary:** Rust commands live in `src-tauri/src/commands/` (one file per domain, re-exported through `mod.rs`). Frontend wrappers live in `src/lib/ipc.ts` with typed return values.
- **Rust crate name is `lit_lib`** — `main.rs` calls `lit_lib::run()`. New commands must be registered in `lib.rs` via `generate_handler!` using full path (e.g. `commands::app_info::get_app_info`).

### Backend modules

| Module | Location | Purpose |
|--------|----------|---------|
| workspace | `src-tauri/src/workspace/` | Page types, frontmatter parsing, scanning, CRUD ops, file watcher, write-hash dedup. All pure-logic, testable without Tauri runtime. |
| graph | `src-tauri/src/graph/` | Knowledge graph backed by SQLite (`store.rs`). Link extraction, indexing with progress reporting, wikilink resolution, PageRank, unlinked mentions. |
| bib | `src-tauri/src/bib/` | Bibliography parsing (BibTeX/YAML), citation rendering, caching. Uses `turboref-core` local crate. |
| commands | `src-tauri/src/commands/` | IPC handlers: `workspace`, `page`, `graph`, `crossref`, `theme`, `keymap`, `preferences`, `cli`, `app_info`, `external_editor`. |
| preferences | `src-tauri/src/preferences.rs` | User preferences file (YAML), live file watcher that emits `lit:preferences-changed` events. |

### Managed state (registered in lib.rs)

The app is **multi-window** — each window has its own workspace. State is keyed by window label:

- `WorkspaceRegistry` — maps window label → workspace root path + file watcher handle
- `PendingWorkspaces/Files/Lines/Cols` — per-window CLI arguments consumed on first load
- `InitialWorkspace/File/Line/Col` — one-shot state for the first window from CLI args
- `WriteHashRegistry` — deduplicates write-page round-trips
- `GraphRegistry` — per-workspace `GraphIndex` (SQLite-backed)
- `GraphBuildState` — tracks index build progress (building/ready/failed)
- `BibCache` — parsed bibliography entries
- `PreferencesWatcher` — file system watcher on the preferences YAML

### App startup flow (lib.rs setup)

1. Parse CLI args → resolve workspace/file/line/col
2. Register plugins (single-instance, dialog, opener, deep-link)
3. Seed bundled themes, keymaps, default preferences
4. **Early graph indexing** — if a workspace is known (from CLI or last-used), spawn a background thread to build the graph index *before* the webview loads, emitting `lit:index-progress` events
5. Register deep-link handler (`lit://` scheme)
6. Create main window with optional CLI init script

### Frontend state

- **Zustand stores** in `src/stores/`: `workspace` (pages, current page, headings, graph state, per-page scroll/cursor positions), `theme`, `preferences`, `focusMode`
- **localStorage keys:** `lit-recent-workspaces`, `lit-workspace-path`, `lit-theme`, `lit-sidebar-position`, `lit-sidebar-tab`

### Frontend structure

- `src/components/` — presentational components (props-driven, no business logic). The `src/components/editor/` subtree holds the CodeMirror 6 integration: extensions, live-preview decorations, fold logic, markdown syntax, theme, focus mode, jump history.
- `src/hooks/` — state hooks (theme, keymaps, file watcher, sidebar, flat tree, mindmap drag/zoom)
- `src/lib/` — IPC wrappers (`ipc.ts`), utilities (headings, fuzzy match, locale search, naming, wikilink navigation, keymap resolver, mindmap layout)
- `src/stores/` — Zustand stores

## Stack

| Layer | Choice |
|-------|--------|
| Shell | Tauri 2 |
| Frontend | React 18 + TypeScript + Vite 6 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite` plugin, no config file) |
| State | Zustand |
| Package manager | bun |
| Test (frontend) | Vitest + jsdom + @testing-library/react |
| Test (backend) | cargo test |
| Lint | ESLint 9 flat config + typescript-eslint |
| CI | GitHub Actions (parallel frontend + Rust jobs) |

## Conventions

### Adding a Tauri command

1. Create `src-tauri/src/commands/my_command.rs` with `#[tauri::command]` function and `#[cfg(test)]` unit test
2. Add `pub mod my_command;` to `src-tauri/src/commands/mod.rs`
3. Register in `src-tauri/src/lib.rs`: add to `generate_handler![..., commands::my_command::the_fn]`
4. Add typed wrapper in `src/lib/ipc.ts`
5. Add frontend test in `src/lib/ipc.test.ts`

### Testing frontend IPC

Tauri's `invoke` is globally mocked in `src/test/setup.ts`. Per-test, set up responses:

```ts
import { mockInvoke } from "../test/tauri-mock";

beforeEach(() => {
  mockInvoke((cmd) => {
    if (cmd === "my_command") return { /* response */ };
    throw new Error(`Unknown command: ${cmd}`);
  });
});
```

`resetInvokeMock()`, `resetListenMock()`, and `localStorage.clear()` run automatically before each test.

Tauri events (`@tauri-apps/api/event`) and dialog (`@tauri-apps/plugin-dialog`) are also globally mocked. Use `mockListen()`, `emitMockEvent()`, and `mockDialogOpen()` from `tauri-mock.ts`.

### Dark mode

Tailwind v4 class-based dark mode via `@custom-variant dark (&:where(.dark, .dark *))` in `src/index.css`. The `useTheme` hook toggles `.dark` on `<html>`. Use `dark:` prefix in Tailwind classes.

### Components

Presentational components in `src/components/` — props-driven, no business logic. State hooks in `src/hooks/`.

### CodeMirror 6 widgets and decorations

- **Never use CSS `margin` on line decorations or widget containers.** CM6 measures line heights via `offsetHeight`/`getBoundingClientRect()`, neither of which includes CSS margins. Use `padding` instead — it is included in `offsetHeight`, so the height map stays accurate. Margin creates a systematic error that corrupts `coordsAtPos()`/`posAtCoords()` for all positions below the affected element, causing arrow-key navigation to skip lines or land at wrong positions.
- **Always provide `estimatedHeight` on `WidgetType` subclasses.** This helps CM6 estimate widget height before DOM measurement, reducing initial height-map error and scroll jitter.
- **Avoid all-or-nothing decoration toggles.** If entering any line of a multi-line construct (e.g. a callout blockquote) removes all decorations simultaneously, the massive layout shift corrupts cursor positioning at the boundary. Prefer per-line proximity checks: keep line classes stable (background/border always visible), and only toggle the current line's content decorations (widget replacements, quote-mark hiding).
- **Click handlers on decorated lines must be scoped narrowly.** If `.cm-callout` line classes are always present (because line decorations are stable), a click handler that intercepts all `.cm-callout` clicks will prevent normal cursor placement on body lines. Scope click interception to specific interactive elements (e.g. `.cm-callout-header` widget) and let body-line clicks fall through to CM6's default handling.

## Gotchas

- `bun test` runs bun's built-in test runner, not vitest. Always use `bun run test` (which calls `bunx vitest run`).
- `tsconfig.node.json` must have `"composite": true` because `tsconfig.json` references it.
- Tauri `generate_handler!` needs the **full module path** to the command function — `pub use` re-exports don't work because the macro also looks for hidden `__cmd__` symbols.
- The icon at `src-tauri/icons/icon.png` must be RGBA format — `generate_context!()` panics otherwise.
- Tauri 2 `app` config has no `title` field — window title goes in `app.windows[].title`.
- Serving local files (images, etc.) in the webview requires three things in sync: `assetProtocol.enable` in `tauri.conf.json`, `protocol-asset` Cargo feature, and a runtime `allow_directory` call on the asset scope. See [[doc/tauri-asset-protocol]] for details.
- Windows are created dynamically in code (not in `tauri.conf.json`'s `windows` array), because each window may have a different workspace and CLI init script.

## Roadmap

See `doc/roadmap.md`.
