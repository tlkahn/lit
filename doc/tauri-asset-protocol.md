# Tauri 2 Asset Protocol — Serving Local Files in the Webview

When the CodeMirror editor renders markdown images (e.g. `![](../img/a.png)`), the raw relative path doesn't work as an `<img src>` in the Tauri webview. The webview resolves relative URLs against its own origin (`http://localhost:1420` in dev), not against the markdown file's location on disk. The result is a broken image icon.

## What's required

Three things must be in place for local images to display:

### 1. Enable the asset protocol in `tauri.conf.json`

```json
"security": {
  "csp": null,
  "assetProtocol": {
    "enable": true
  }
}
```

This tells `tauri-build` to activate the `protocol-asset` Cargo feature, which registers the `asset://` custom scheme handler in the webview.

### 2. Add the matching Cargo feature

```toml
tauri = { version = "2", features = ["protocol-asset"] }
```

The `tauri-build` build script validates that the features in `Cargo.toml` match the config. If they disagree in either direction, compilation fails with "does not match the allowlist." You cannot add the feature without the config or vice versa — both must be set together.

### 3. Allow the workspace directory in the asset scope at runtime

The asset protocol has an empty scope by default — it won't serve any files until you explicitly allow paths. Since the workspace directory is only known at runtime (when the user opens one), the scope must be updated dynamically:

```rust
// In open_workspace command:
app_handle
    .asset_protocol_scope()
    .allow_directory(&root, true)   // recursive
    .map_err(|e| e.to_string())?;
```

This requires `use tauri::Manager;` for the `asset_protocol_scope()` method.

## Frontend: converting paths to asset URLs

Use `convertFileSrc` from `@tauri-apps/api/core` to turn an absolute filesystem path into a URL the webview can load:

```typescript
import { convertFileSrc } from "@tauri-apps/api/core";

// "/Users/foo/vault/img/a.png" → "asset://localhost/%2FUsers%2Ffoo%2Fvault%2Fimg%2Fa.png"
const url = convertFileSrc(absolutePath);
```

The implementation lives in `src/components/ContentArea.tsx` (`resolveImageSrc` callback), which resolves the relative markdown path against the current file's directory, then calls `convertFileSrc`. This resolver is threaded into the CodeMirror decoration system via a `Facet` (`src/editor/livePreview/imageResolver.ts`), using a ref pattern in `useCodeMirror.ts` so it stays current when the user switches files without recreating the editor.

## Failure modes

| Symptom | Cause |
|---------|-------|
| `unsupported URL (/absolute/path/to/img.png)` | `convertFileSrc` not called — raw filesystem path used as `img.src` |
| `Failed to load resource` with `asset://localhost/...` | Asset protocol not enabled (missing `assetProtocol.enable` in config) or Cargo feature mismatch |
| 403 / empty response from `asset://` URL | Workspace directory not added to asset scope (`allow_directory` not called) |
| Build error: "does not match the allowlist" | `Cargo.toml` features and `tauri.conf.json` `assetProtocol.enable` are out of sync |
