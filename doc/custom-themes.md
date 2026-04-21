# Custom Themes

Lit uses an Obsidian-compatible CSS variable system. Community themes from Obsidian can be adapted to work in Lit with minimal changes.

## Installing a theme

1. Open the themes folder from the **Theme** dropdown in the toolbar (click "Open themes folder"), or navigate manually to the app data directory:
   - **macOS:** `~/Library/Application Support/com.lit.app/themes/`
   - **Linux:** `~/.local/share/com.lit.app/themes/`
   - **Windows:** `%APPDATA%\com.lit.app\themes\`
2. Create a subfolder for the theme (e.g. `my-theme/`).
3. Add two files inside the subfolder:

```
themes/
  my-theme/
    manifest.json
    theme.css
```

### manifest.json

```json
{
  "name": "My Theme",
  "version": "1.0.0",
  "author": "Your Name"
}
```

### theme.css

Override any of the CSS variables listed below. Scope light-mode values under `.theme-light` and dark-mode values under `.theme-dark`:

```css
.theme-light {
  --background-primary: #ffffff;
  --text-normal: #1f2328;
  --text-accent: #0969da;
}

.theme-dark {
  --background-primary: #0d1117;
  --text-normal: #f0f6fc;
  --text-accent: #4493f8;
}
```

4. Restart Lit (or reopen the Theme dropdown). The theme appears in the list and can be activated with one click.

## Activating / deactivating

Click the **Theme** button in the toolbar header. Select a theme to activate it, or select **Default** to return to the built-in GitHub-style theme. Your choice is persisted across sessions.

## Available CSS variables

### Backgrounds

| Variable | Purpose |
|---|---|
| `--background-primary` | Main editor / content background |
| `--background-primary-alt` | Header bar, content area wrapper |
| `--background-secondary` | Sidebar background |
| `--background-secondary-alt` | Sidebar hover states |
| `--background-modifier-border` | Border color for inputs, dropdowns, sidebar edge |
| `--background-modifier-hover` | Generic hover background |

### Text

| Variable | Purpose |
|---|---|
| `--text-normal` | Primary body text |
| `--text-muted` | Secondary text (list markers, quotes) |
| `--text-faint` | Tertiary text (section labels, meta) |
| `--text-accent` | Links, accent-colored text |
| `--text-accent-hover` | Link hover state |
| `--text-error` | Error messages |
| `--text-on-accent` | Text on accent-colored backgrounds |
| `--text-selection` | Editor text selection highlight |

### Interactive

| Variable | Purpose |
|---|---|
| `--interactive-accent` | Primary buttons, active accents |
| `--interactive-accent-hover` | Hover state for primary buttons |

### Navigation

| Variable | Purpose |
|---|---|
| `--nav-item-color-active` | Active sidebar item text |
| `--nav-item-background-active` | Active sidebar item background |

### Code

| Variable | Purpose |
|---|---|
| `--code-background` | Inline code and code block background |

### Extended colors (callouts)

| Variable | Purpose |
|---|---|
| `--color-red` | Danger / failure callouts |
| `--color-green` | Tip / success callouts |
| `--color-blue` | Note / info callouts |
| `--color-orange` | Bug callouts |
| `--color-yellow` | Warning / question callouts |
| `--color-purple` | Example callouts, wikilinks |
| `--color-cyan` | Abstract callouts |

### Fonts

| Variable | Purpose |
|---|---|
| `--font-text-theme` | Editor body text |
| `--font-interface-theme` | UI chrome (sidebar, buttons, headers) |
| `--font-monospace-theme` | Code blocks, monospace elements |

### Color base scale

`--color-base-00` through `--color-base-100` provide a neutral ramp from lightest to darkest (light mode) or darkest to lightest (dark mode). These are available for fine-grained control but not required.

## Porting Obsidian themes

Most Obsidian community themes already use these same CSS variables. To port one:

1. Copy the theme's `theme.css` and `manifest.json` into a subfolder under the themes directory.
2. Verify the theme scopes its variables under `.theme-light` / `.theme-dark` (Obsidian uses the same selectors on `<body>`; Lit applies them on `<html>`).
3. Remove any Obsidian-specific selectors that target internal Obsidian classes (e.g. `.workspace-leaf`, `.nav-file`). These have no effect in Lit and can be safely deleted to reduce file size.
