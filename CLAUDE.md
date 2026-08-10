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
- **Annotation grammar** lives in `tlkahn/lit-annotation-core` (git dep, pinned tag; re-exported as `lit_lib::annotation`). Grammar changes go to that crate first, then bump the tag here. Never reimplement or patch grammar behavior in-tree.

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
- **If `bun run test` ever hangs** (worker pegged at 100% CPU, no vitest timeout firing): it's a promise/setState microtask livelock, NOT memory pressure - do not reintroduce sharding/memory-limit workarounds. Capture stderr and look for an endlessly repeating `act(...)` warning (it names the host component), then stub that component. Full playbook and history: `doc/reports/2026-07-14-vitest-suite-hang-settingsmodal-livelock.md`. The original livelock (SettingsModal's stale-colorTheme reconcile effect: optimistic-null + reject-revert ping-pong when `set_preference` rejects) was root-caused and fixed in #891 by moving stale-theme cleanup into the theme store (`syncFromPreferences`, gated on `themesLoaded`, persist with no revert) and deleting the modal effect.
- **Components mounted unconditionally by `App` (or hidden via `display:none`/an `open` prop) run their effects in every `render(<App />)` test.** Mount lazily in prod (see ReferenceLibrary in `Sidebar.tsx`), and stub heavy children in app-level wiring tests - they all have their own test files.
- **Nerd Font codepoints: verify before coding.** The bundled `src/fonts/SymbolsNerdFontMono-Regular.woff2` only contains a subset of the Nerd Fonts catalog. Before using a new codepoint, check it exists in the shipped font:
  ```bash
  .venv/bin/python -c "
  from fontTools.ttLib import TTFont
  cmap = TTFont('src/fonts/SymbolsNerdFontMono-Regular.woff2').getBestCmap()
  print(cmap.get(0xYOUR_HEX, 'MISSING'))"
  ```
  Always resolve pasted glyphs with `ord('...')` rather than trusting icon-picker labels - names and codepoints frequently disagree.

## Releasing

Releases run locally — there is no CI pipeline.

```bash
bash scripts/release.sh <tag>                  # full release
bash scripts/release.sh --dry-run <tag>        # build only, no upload
bash scripts/release.sh --skip-website <tag>   # skip website deploy
```

Release and install builds are free-by-default (`free-distribution` is a Cargo default feature); there is no `--free-distribution` flag.

License QA: the native Help menu's license items compile out under the default
`free-distribution` feature; exercise the paid/license UI with feature-off
builds (`cargo build --no-default-features`). `LIT_LICENSE_DEV=unlicensed`
(also `licensed`/`expired`/`revoked`) still forces the matching splash in debug
builds via the `get_license_status` debug override, which runs before the free
grant - so license-state QA does not need a feature toggle.

Website: the live site currently keeps `freeDistribution = false` from the last
old-path deploy; the next TAGGED release flips it to `true`. The notes-only
`deploy-website.sh` path intentionally never touches the parameter.

Required env vars: `LIT_LICENSE_VERIFYING_KEY_B64`, `TAURI_SIGNING_PRIVATE_KEY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
Optional: `APPLE_SIGNING_IDENTITY`, `ANTHROPIC_API_KEY`, `LLM_MODEL`.

```bash
bash scripts/publish-cards.sh <html_file> [slug]          # publish cardbox HTML to https://lit.solar/z/<slug>/
bash scripts/publish-cards.sh --delete <slug>              # remove a published page
```

Pages are unlisted (link-shareable only, no `/z/` index).

## Roadmap

See `doc/roadmap.md`.
