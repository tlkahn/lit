# Lit

A local-first outliner with bidirectional linking, built with Tauri 2 + React/TypeScript.

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Bun](https://bun.sh/) (v1.0+)
- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

## Setup

```bash
bun install
```

## Development

```bash
bun tauri dev
```

## Running Tests

```bash
# Frontend tests
bun test

# Rust tests
cd src-tauri && cargo test

# Type checking
bun run typecheck

# Linting
bun run lint
```

## Project Structure

```
lit/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/              # React hooks (theme, sidebar position)
│   ├── lib/                # IPC and utility modules
│   └── test/               # Test setup and mocks
├── src-tauri/              # Rust backend
│   └── src/commands/       # Tauri IPC commands
└── doc/                    # Documentation
```
