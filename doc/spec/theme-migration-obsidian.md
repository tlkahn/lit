# Theme Migration: Obsidian to Lit

Specification for porting Obsidian community themes to Lit's theme system.

## Overview

Lit implements an Obsidian-compatible CSS variable contract. Most Obsidian community themes can be ported by extracting the variable declarations from their `theme.css`, stripping Obsidian-specific selectors, and packaging the result as a Lit theme directory. This document defines the variable contract, the structural differences between the two systems, and a step-by-step migration procedure.

## Theme Package Format

Both Obsidian and Lit use the same directory structure:

```
<theme-dir>/
  manifest.json
  theme.css
```

### manifest.json

```json
{
  "name": "Theme Name",
  "version": "1.0.0",
  "author": "Author Name"
}
```

Obsidian manifests include additional fields (`minAppVersion`, `authorUrl`, `fundingUrl`). Lit ignores unknown fields, so the original manifest works as-is.

### Installation path

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/com.lit.app/themes/<theme-dir>/` |
| Linux | `~/.local/share/com.lit.app/themes/<theme-dir>/` |
| Windows | `%APPDATA%\com.lit.app\themes\<theme-dir>\` |

## CSS Variable Contract

Lit defines 47 CSS variables per mode. Theme CSS must scope values under `.theme-light` and/or `.theme-dark`. All variables are optional; unset variables fall back to Lit's built-in defaults (sourced from github-markdown-css 5.8.1).

### Backgrounds

| Variable | Purpose |
|---|---|
| `--background-primary` | Main editor/content area |
| `--background-primary-alt` | Header bar, content wrapper |
| `--background-secondary` | Sidebar |
| `--background-secondary-alt` | Sidebar secondary surfaces |
| `--background-modifier-border` | Borders on inputs, dropdowns, sidebar edge |
| `--background-modifier-hover` | Generic hover background |
| `--background-modifier-error` | Error-state background tint |

### Text

| Variable | Purpose |
|---|---|
| `--text-normal` | Primary body text |
| `--text-muted` | Secondary text (list markers, blockquotes) |
| `--text-faint` | Tertiary text (section labels, metadata) |
| `--text-accent` | Links, accent-colored text |
| `--text-accent-hover` | Link hover state |
| `--text-error` | Error messages |
| `--text-on-accent` | Text rendered on accent-colored backgrounds |
| `--text-selection` | Editor text selection highlight |

### Interactive

| Variable | Purpose |
|---|---|
| `--interactive-normal` | Button/control resting state |
| `--interactive-hover` | Button/control hover state |
| `--interactive-accent` | Primary action buttons, active accents |
| `--interactive-accent-hover` | Hover state for primary actions |

### Navigation

| Variable | Purpose |
|---|---|
| `--nav-item-color-active` | Active sidebar item text |
| `--nav-item-background-active` | Active sidebar item background |
| `--nav-item-color-hover` | Sidebar item hover text |
| `--nav-item-background-hover` | Sidebar item hover background |

### Code

| Variable | Purpose |
|---|---|
| `--code-background` | Inline code and code block background |
| `--code-normal` | Code text color |

### Extended Colors

Used by callout decorations. Lit's live-preview engine uses `color-mix(in srgb, var(--color-*) 8%, transparent)` for callout background tints, so these values should be chosen for readability at both full intensity (border) and 8% opacity (background).

| Variable | Callout types |
|---|---|
| `--color-red` | danger, failure |
| `--color-green` | tip, success |
| `--color-blue` | note, info, todo |
| `--color-orange` | bug |
| `--color-yellow` | warning, question |
| `--color-purple` | example; also used for wikilinks |
| `--color-cyan` | abstract |

### Fonts

| Variable | Purpose |
|---|---|
| `--font-text-theme` | Editor body text font stack |
| `--font-interface-theme` | UI chrome (sidebar, buttons, toolbar) |
| `--font-monospace-theme` | Code blocks, monospace elements |

### Color Base Scale

A neutral ramp from surface to foreground. In light mode, `--color-base-00` is lightest and `--color-base-100` is darkest; in dark mode the direction reverses. These are optional but give the theme fine-grained control over neutral tones.

| Variable | Light mode role | Dark mode role |
|---|---|---|
| `--color-base-00` | White / lightest surface | Deepest background |
| `--color-base-05` | Near-white | Slightly lighter than 00 |
| `--color-base-10` | Subtle surface | Secondary surface |
| `--color-base-20` | Border-weight neutral | Border-weight neutral |
| `--color-base-25` | Mid-light | Mid-dark |
| `--color-base-30` | Muted foreground | Muted foreground |
| `--color-base-35` | Secondary text weight | Secondary text weight |
| `--color-base-40` | Subdued foreground | Subdued foreground |
| `--color-base-50` | Dark neutral | Light neutral |
| `--color-base-60` | Darker neutral | Lighter neutral |
| `--color-base-70` | Near-foreground | Near-foreground |
| `--color-base-100` | Darkest / foreground | Lightest / foreground |

## Structural Differences

### Selector scope target

| | Obsidian | Lit |
|---|---|---|
| Element | `<body>` | `<html>` |
| Selectors | `.theme-light` / `.theme-dark` | `.theme-light` / `.theme-dark` |

The class names are identical. Because `.theme-light` and `.theme-dark` are applied to `<html>` in Lit, variables cascade to all descendants including `<body>`. Themes that scope under these class selectors work in both apps without changes.

Themes that target `body.theme-dark` (element-qualified selector) will fail in Lit since the classes live on `<html>`, not `<body>`. Replace with `.theme-dark`.

### Tailwind dark mode integration

Lit applies both `.theme-dark` and `.dark` to `<html>` simultaneously. The `.dark` class drives Tailwind's `dark:` variant for utility classes in Lit's own components. Theme CSS does not need to reference `.dark`.

### CSS injection mechanism

Lit injects the active theme's CSS into a `<style id="lit-custom-theme">` element in `<head>`. The theme CSS is loaded as a raw string and set as `textContent`. This means:

- `@import` rules inside theme CSS will not resolve (no base URL context).
- `url()` references to local files will not resolve.
- All values must be self-contained hex, rgb/hsl, or CSS functions like `color-mix()`.

### Obsidian `app.css` variables not supported

Obsidian exposes hundreds of additional internal CSS variables (prefixed `--` but not part of the documented theme API) that control its specific UI components. These have no effect in Lit:

- `--titlebar-*`, `--tab-*`, `--ribbon-*`, `--status-bar-*`
- `--modal-*`, `--prompt-*`, `--graph-*`, `--canvas-*`
- `--embed-*`, `--tag-*`, `--table-*`
- `--scrollbar-*`, `--blockquote-*`, `--hr-*`
- `--file-*`, `--tree-*`, `--vault-*`
- `--checkbox-*`, `--toggle-*`, `--slider-*`

Theme CSS may include these variables harmlessly (browsers ignore unknown custom properties), but they produce no visual effect. Stripping them reduces file size.

### Obsidian UI selectors not supported

Obsidian themes commonly style internal DOM classes. These selectors have no effect in Lit and should be removed:

- `.workspace`, `.workspace-leaf`, `.workspace-split`, `.workspace-drawer`
- `.nav-file`, `.nav-folder`, `.nav-header`
- `.sidebar-toggle-button`, `.view-header`, `.view-content`
- `.markdown-preview-view`, `.markdown-rendered`, `.markdown-source-view`
- `.setting-item`, `.modal-container`, `.suggestion-*`
- `.is-phone`, `.is-tablet`, `.is-mobile`, `.mod-*`
- `.cm-s-obsidian` (Obsidian's CodeMirror scope)

Lit uses its own component classes and CodeMirror theme extensions (`src/editor/theme.ts`, `src/editor/livePreview/theme.ts`), which read CSS variables directly.

### CodeMirror theming

Obsidian themes may include CodeMirror 6 overrides (`.cm-editor`, `.cm-content`, `.cm-cursor`, etc.). Lit configures CodeMirror programmatically via `EditorView.theme()`, reading CSS variables like `--background-primary`, `--text-normal`, and `--text-selection`. Direct `.cm-*` selectors in theme CSS will work but may conflict with Lit's programmatic theme. Prefer setting the underlying CSS variables rather than targeting `.cm-*` classes.

### `@media (prefers-color-scheme)` queries

Some Obsidian themes use `@media (prefers-color-scheme: dark)` for auto-switching. Lit uses explicit class-based switching (`.theme-light` / `.theme-dark`), so media queries should be converted to the corresponding class selectors.

## Migration Procedure

### Step 1: Copy source files

Copy `manifest.json` and `theme.css` from the Obsidian theme into a new directory under Lit's themes path.

### Step 2: Extract variable declarations

From `theme.css`, keep only the `.theme-light { ... }` and `.theme-dark { ... }` blocks containing CSS variable declarations (`--variable-name: value`). This is the portable core of the theme.

### Step 3: Remove Obsidian-specific content

Delete:

1. All rule blocks targeting Obsidian internal classes (see list above).
2. All `@media (prefers-color-scheme)` blocks — replace with class-scoped equivalents if the values differ from what's in `.theme-light` / `.theme-dark`.
3. Any `@import` or `url()` references to external resources.
4. Obsidian-only variable declarations that Lit does not consume (the `--titlebar-*` family, etc.). These are harmless but add dead weight.

### Step 4: Fix selector qualification

Replace element-qualified selectors:

```css
/* Before — breaks in Lit */
body.theme-dark { --background-primary: #2e3440; }

/* After — works in both */
.theme-dark { --background-primary: #2e3440; }
```

### Step 5: Verify extended colors

Check that `--color-red` through `--color-cyan` are defined for both modes. These drive callout rendering. If the source theme omits them, derive values from the theme's palette. For light mode, ensure sufficient contrast against `--background-primary`; for dark mode, ensure readability at 8% opacity against the background.

### Step 6: Verify font stacks

If the source theme sets `--font-text-theme`, `--font-interface-theme`, or `--font-monospace-theme`, verify the fonts are available or fall back gracefully. Web fonts loaded via `@import` or `@font-face url()` will not work in Lit's injection model — only system-installed fonts and generic families are supported.

### Step 7: Populate color base scale (optional)

If the source theme defines `--color-base-00` through `--color-base-100`, keep them. If not, they can be derived by interpolating between the theme's background and foreground colors across the 12-stop scale. This is optional; Lit's defaults apply if omitted.

### Step 8: Test

1. Place the theme directory under Lit's themes path.
2. Launch Lit and activate the theme from the toolbar dropdown.
3. Verify in both light and dark modes:
   - Sidebar: background, active/hover item colors, text legibility.
   - Editor: background, body text, headings, links, inline code, code blocks.
   - Callouts: each type renders with the correct accent color (border and 8% tint).
   - Wikilinks: rendered in `--color-purple`.
   - Selection highlight: visible against the editor background.
   - Toolbar/header: background blends with the overall theme.
4. Deactivate the theme and confirm the default theme restores cleanly.

## Example: Minimal Migration

Source Obsidian theme (before):

```css
body.theme-dark {
  --background-primary: #1e1e2e;
  --text-normal: #cdd6f4;
  --text-accent: #89b4fa;
}

body.theme-light {
  --background-primary: #eff1f5;
  --text-normal: #4c4f69;
  --text-accent: #1e66f5;
}

.workspace-leaf {
  border-radius: 8px;
}

.nav-file-title {
  font-size: 13px;
}
```

Migrated Lit theme (after):

```css
.theme-dark {
  --background-primary: #1e1e2e;
  --text-normal: #cdd6f4;
  --text-accent: #89b4fa;
}

.theme-light {
  --background-primary: #eff1f5;
  --text-normal: #4c4f69;
  --text-accent: #1e66f5;
}
```

The `.workspace-leaf` and `.nav-file-title` rules are removed (Obsidian-specific, no effect in Lit). The `body` qualifier is removed from the selectors. Unset variables (`--text-muted`, `--code-background`, etc.) fall back to Lit's built-in defaults.

## Compatibility Matrix

| Feature | Obsidian | Lit | Migration action |
|---|---|---|---|
| `.theme-light` / `.theme-dark` scoping | On `<body>` | On `<html>` | Remove `body` qualifier if present |
| CSS variable declarations | Supported | Supported | Keep as-is |
| `@import` in theme CSS | Resolved by browser | Not resolved (injected as text) | Inline imported content |
| `url()` asset references | Resolved from vault | Not resolved | Remove or use data URIs |
| `@font-face` with file URLs | Works | Not resolved | Remove; use system fonts |
| `@media (prefers-color-scheme)` | Works | Ignored (class-based switching) | Convert to class selectors |
| Obsidian internal selectors | Styled | No matching DOM | Remove |
| Obsidian-only CSS variables | Consumed by app | Ignored | Remove (optional, harmless) |
| `manifest.json` extra fields | Consumed | Ignored | Keep (harmless) |
| `color-mix()` in values | Supported | Supported | Keep as-is |
| CSS `calc()` in values | Supported | Supported | Keep as-is |

## Automation Opportunities

A migration tool could automate steps 2-5:

1. Parse `theme.css` with a CSS parser.
2. Walk all rule blocks; keep only those whose selector is `.theme-light` or `.theme-dark` (ignoring element qualification).
3. Within kept blocks, retain only declarations whose property starts with `--` and matches the 47 known variable names.
4. Emit the cleaned CSS.

This is a potential future CLI command (`lit theme import <path>`) but is not currently implemented.
