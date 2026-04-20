# Lit

Local-first outliner with bidirectional linking. Tauri 2 desktop app — Rust backend, React/TypeScript frontend.

## Quick Reference

```bash
bun install                # install frontend deps
bun tauri dev              # run the full app (frontend + Rust)
bun run test               # vitest (uses `bunx vitest run`, NOT `bun test`)
bun run test:watch         # vitest watch mode
bun run lint               # eslint
bun run typecheck          # tsc --noEmit
cd src-tauri && cargo test # rust tests
```

## Architecture

- **Rust owns data, JS owns pixels.** File I/O, parsing, indexing — Rust. UI rendering — React.
- **IPC boundary:** Rust commands live in `src-tauri/src/commands/` (one file per command, re-exported through `mod.rs`). Frontend wrappers live in `src/lib/ipc.ts` with typed return values.
- **Rust crate name is `lit_lib`** — `main.rs` calls `lit_lib::run()`. New commands must be registered in `lib.rs` via `generate_handler!` using full path (e.g. `commands::app_info::get_app_info`).
- **Workspace module:** `src-tauri/src/workspace/` — page types, frontmatter parsing, scanning, CRUD ops, file watcher. All pure-logic, testable without Tauri runtime.
- **Managed state:** `AppState` (workspace root + file watcher) in `commands/workspace.rs`, registered via `.manage()` in `lib.rs`.
- **Frontend state:** Zustand store in `src/stores/workspace.ts`. localStorage persists `lit-workspace-path`, `lit-theme`, `lit-sidebar-position`.

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

## Gotchas

- `bun test` runs bun's built-in test runner, not vitest. Always use `bun run test` (which calls `bunx vitest run`).
- `tsconfig.node.json` must have `"composite": true` because `tsconfig.json` references it.
- Tauri `generate_handler!` needs the **full module path** to the command function — `pub use` re-exports don't work because the macro also looks for hidden `__cmd__` symbols.
- The icon at `src-tauri/icons/icon.png` must be RGBA format — `generate_context!()` panics otherwise.
- Tauri 2 `app` config has no `title` field — window title goes in `app.windows[].title`.
- Serving local files (images, etc.) in the webview requires three things in sync: `assetProtocol.enable` in `tauri.conf.json`, `protocol-asset` Cargo feature, and a runtime `allow_directory` call on the asset scope. See [[doc/tauri-asset-protocol]] for details.

## Roadmap

See `doc/roadmap.md`. Stages 0-1 complete. Next: Stage 2 (outliner block editor).
