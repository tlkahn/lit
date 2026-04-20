# Stage 0 — Project Bootstrap

Completed 2026-04-20.

## What Was Built

### Scaffold

- Tauri 2 + Vite 6 + React 18 + TypeScript project with bun as package manager
- Tailwind CSS v4 via `@tailwindcss/vite` plugin, with class-based dark mode (`@custom-variant dark (&:where(.dark, .dark *))` — no `tailwind.config.ts` needed)
- ESLint 9 flat config with `typescript-eslint`
- Vitest with jsdom environment, `@testing-library/react`, and global Tauri invoke mock infrastructure

### Rust Backend

- `get_app_info` IPC command returning `{ name: "Lit", version: "0.1.0" }`, tested via `cargo test`
- Modular command structure under `src-tauri/src/commands/` (each command in its own file, re-exported through `mod.rs`)
- Crate name: `lit_lib` (referenced by `main.rs`)

### Frontend

- IPC layer (`src/lib/ipc.ts`) wrapping `@tauri-apps/api/core` invoke calls with typed return values
- `useTheme` hook — auto-detects system preference via `matchMedia`, supports manual toggle, persists to `localStorage` (`lit-theme`), applies `.dark` class to `<html>`
- `useSidebarPosition` hook — defaults to left, toggles left/right, persists to `localStorage` (`lit-sidebar-position`)
- Four presentational components: `Sidebar`, `ContentArea`, `ThemeToggle`, `SidebarPositionToggle`
- App layout uses `flex-row` / `flex-row-reverse` to swap sidebar position

### Testing

- Tauri invoke mock: `vi.mock("@tauri-apps/api/core")` hoisted in `src/test/setup.ts`; per-test handler via `mockInvoke()` in `src/test/tauri-mock.ts`
- 15 vitest tests across 4 files: IPC (2), useTheme (5), useSidebarPosition (3), App integration (5)
- 1 Rust unit test for `get_app_info`

### CI

- GitHub Actions workflow (`.github/workflows/ci.yml`) with two parallel jobs:
  - `check-frontend`: bun install, typecheck, lint, test
  - `check-rust`: cargo check + cargo test with Ubuntu webkit/GTK deps (`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`)

## Project Structure

```
lit/
├── .github/workflows/ci.yml
├── doc/
├── src-tauri/
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       └── commands/
│           ├── mod.rs
│           └── app_info.rs
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── App.test.tsx
│   ├── index.css
│   ├── vite-env.d.ts
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── ContentArea.tsx
│   │   ├── ThemeToggle.tsx
│   │   └── SidebarPositionToggle.tsx
│   ├── hooks/
│   │   ├── useTheme.ts
│   │   ├── useTheme.test.ts
│   │   ├── useSidebarPosition.ts
│   │   └── useSidebarPosition.test.ts
│   ├── lib/
│   │   ├── ipc.ts
│   │   └── ipc.test.ts
│   └── test/
│       ├── setup.ts
│       └── tauri-mock.ts
├── index.html
├── package.json
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── eslint.config.js
├── .gitignore
└── README.md
```

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Package manager | bun | Fast installs, native TS execution |
| Tailwind version | v4 with `@tailwindcss/vite` | No config file needed, CSS-native custom variants |
| Dark mode strategy | Class-based (`.dark` on `<html>`) | Works with Tailwind v4 `@custom-variant`, supports both system detection and manual toggle |
| Sidebar position | `flex-row-reverse` swap | Single CSS class change, no DOM reordering |
| Tauri invoke mock | Global `vi.mock` + per-test `mockInvoke()` | Hoisted mock avoids import order issues; handler per test keeps tests isolated |
| Rust command layout | `commands/` directory with `mod.rs` re-exports | Scales cleanly as commands are added in later stages |
