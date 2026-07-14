# CLAUDE.md

Local-first notetaker and knowledge graph manager. Tauri 2 desktop app — Rust backend, React/TypeScript frontend.

## Commands

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
bash scripts/install.sh              # full release build + install to /Applications
bun tauri build                      # release build (lit-cli bundled via externalBin)
```

## Core Architecture

- **Rust owns data, JS owns pixels.** File I/O, parsing, indexing — Rust. UI rendering — React.
- **IPC boundary:** Rust commands in `src-tauri/src/commands/` (one file per domain). Frontend wrappers in `src/lib/ipc.ts`.
- **Rust crate name is `lit_lib`** — commands registered in `lib.rs` via `generate_handler!` using full module path.
- **Multi-window** — each window has its own workspace, state keyed by window label.

See `doc/architecture.md` for full module map, state registry, startup flow, and frontend structure.

## Adding a Tauri command

1. Create `src-tauri/src/commands/my_command.rs` with `#[tauri::command]` fn + `#[cfg(test)]` unit test
2. Add `pub mod my_command;` to `src-tauri/src/commands/mod.rs`
3. Register in `src-tauri/src/lib.rs`: `generate_handler![..., commands::my_command::the_fn]`
4. Add typed wrapper in `src/lib/ipc.ts`
5. Add frontend test in `src/lib/ipc.test.ts`

## CodeMirror 6 constraints

- **Never use CSS `margin` on line decorations or widget containers.** CM6 measures line heights via `offsetHeight` which excludes margins. Use `padding` instead — it's included in `offsetHeight`, so the height map stays accurate.
- **Always provide `estimatedHeight` on `WidgetType` subclasses.**
- **Avoid all-or-nothing decoration toggles.** Prefer per-line proximity checks: keep line classes stable, only toggle current line's content decorations.
- **Scope click handlers narrowly on decorated lines.** Intercept clicks on specific interactive elements (e.g. `.cm-callout-header`), let body-line clicks fall through to CM6.

## Gotchas

- `bun test` ≠ vitest. Always `bun run test`.
- `generate_handler!` needs full module path — `pub use` re-exports don't work (macro looks for hidden `__cmd__` symbols).
- `src-tauri/icons/icon.png` must be RGBA — `generate_context!()` panics otherwise.
- Tauri 2 has no `app.title` — window title goes in `app.windows[].title`.
- Local file serving requires: `assetProtocol.enable` + `protocol-asset` Cargo feature + runtime `allow_directory`.
- Windows are created dynamically in code, not in `tauri.conf.json`'s `windows` array.
- **If `bun run test` ever hangs** (worker pegged at 100% CPU, no vitest timeout firing): it's a promise/setState microtask livelock, NOT memory pressure - do not reintroduce sharding/memory-limit workarounds. Capture stderr and look for an endlessly repeating `act(...)` warning (it names the host component), then stub that component. Full playbook and history: `doc/reports/2026-07-14-vitest-suite-hang-settingsmodal-livelock.md`. Known deferred root cause: SettingsModal's IPC effects loop under some interleavings; `App.test.tsx` masks it with a stub.
- **Components mounted unconditionally by `App` (or hidden via `display:none`/an `open` prop) run their effects in every `render(<App />)` test.** Mount lazily in prod (see ReferenceLibrary in `Sidebar.tsx`), and stub heavy children in app-level wiring tests - they all have their own test files.

## Releasing

Releases run locally — there is no CI pipeline.

```bash
bash scripts/release.sh <tag>                  # full release
bash scripts/release.sh --dry-run <tag>        # build only, no upload
bash scripts/release.sh --skip-website <tag>   # skip website deploy
```

Required env vars: `LIT_LICENSE_VERIFYING_KEY_B64`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
Optional: `APPLE_SIGNING_IDENTITY`, `ANTHROPIC_API_KEY`, `LLM_MODEL`.

## Roadmap

See `doc/roadmap.md`.
